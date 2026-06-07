import { ApiError, RuntimeEnv } from "./http";
import { ensureDatabaseSchema } from "./schema";
import { domainFromEmail, getDefaultDomain, normalizeDomain } from "./db";
import { configuredAdminPassword } from "./configuration";

const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 100_000;
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_COOKIE_NAME = "omnidock_session";
const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCK_MS = 15 * 60 * 1000;
const AUTH_MAX_FAILURES = 5;

type AdminAuthRow = {
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  admin_name: string | null;
  admin_email: string | null;
  reset_token_hash: string | null;
  reset_expires_at: string | null;
};

type AuthAttemptRow = {
  failures: number;
  locked_until: string | null;
  updated_at: string;
};

type AdminSessionRow = {
  token_hash: string;
  expires_at: string;
};

export type SetupStatus = {
  setupRequired: boolean;
  resetAvailable: boolean;
};

export async function requireAdmin(request: Request, env: RuntimeEnv): Promise<void> {
  await ensureDatabaseSchema(env);

  const provided = extractPassword(request);
  const record = await getAdminAuth(env);

  const sessionToken = extractSessionToken(request);
  if (record && sessionToken) {
    if (await verifyAdminSession(env, sessionToken)) {
      return;
    }
    throw new ApiError(401, "session_expired", "Session expired. Log in again.");
  }

  if (!record) {
    await bootstrapPassword(env, provided, request);
    return;
  }

  await enforceAuthRateLimit(env, request);
  if (!provided || !(await verifyPassword(provided, record))) {
    await recordFailedAuthAttempt(env, request);
    throw new ApiError(401, "unauthorized", "Invalid password");
  }
  await clearAuthAttempt(env, request);
}

export async function getSetupStatus(env: RuntimeEnv): Promise<SetupStatus> {
  if (!env.DB) {
    return {
      setupRequired: true,
      resetAvailable: false
    };
  }

  await ensureDatabaseSchema(env);
  const record = await getAdminAuth(env);

  return {
    setupRequired: !record,
    resetAvailable: Boolean(record?.admin_email)
  };
}

export async function createAdminAccount(
  env: RuntimeEnv,
  input: { name: string; email: string; recoveryEmail: string; primaryDomain: string; password?: string | null },
  request?: Request
): Promise<void> {
  await ensureDatabaseSchema(env);
  const existing = await getAdminAuth(env);
  if (existing) {
    throw new ApiError(409, "setup_complete", "Admin account is already configured");
  }

  const name = normalizeAdminName(input.name);
  normalizeAdminEmail(input.email);
  const recoveryEmail = normalizeAdminEmail(input.recoveryEmail);
  validateExternalRecoveryEmail(recoveryEmail, input.primaryDomain);
  const password = configuredAdminPassword(env);
  const setupPassword = input.password?.trim() ?? "";
  if (!password) {
    throw new ApiError(409, "admin_password_secret_missing", "Add ADMIN_PASSWORD as a Worker secret first.");
  }
  if (request) {
    await enforceAuthRateLimit(env, request);
  }
  if (!setupPassword || !(await securePlainEqual(setupPassword, password))) {
    if (request) {
      await recordFailedAuthAttempt(env, request);
    }
    throw new ApiError(401, "unauthorized", "Invalid setup password");
  }
  if (request) {
    await clearAuthAttempt(env, request);
  }
  validatePassword(password);

  const salt = randomSalt();
  const hash = await hashPassword(password, salt, PASSWORD_ITERATIONS);

  await env.DB.prepare(
    `INSERT INTO admin_auth (
      id, password_hash, password_salt, password_iterations,
      admin_name, admin_email
    )
    VALUES ('primary', ?, ?, ?, ?, ?)`
  )
    .bind(hash, salt, PASSWORD_ITERATIONS, name, recoveryEmail)
    .run();
}

export async function setAdminPassword(env: RuntimeEnv, password: string): Promise<void> {
  validatePassword(password);

  await ensureDatabaseSchema(env);
  const salt = randomSalt();
  const hash = await hashPassword(password, salt, PASSWORD_ITERATIONS);

  await env.DB.prepare(
    `INSERT INTO admin_auth (id, password_hash, password_salt, password_iterations)
     VALUES ('primary', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       password_iterations = excluded.password_iterations,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(hash, salt, PASSWORD_ITERATIONS)
    .run();

  await clearAdminSessions(env);
}

export async function createAdminSession(env: RuntimeEnv, request: Request, password: string): Promise<string> {
  await ensureDatabaseSchema(env);
  await enforceAuthRateLimit(env, request);

  let record = await getAdminAuth(env);
  if (!record) {
    const bootstrap = configuredAdminPassword(env);
    if (!bootstrap) {
      throw new ApiError(409, "setup_required", "Create the first admin account before logging in.");
    }
    if (!(await securePlainEqual(password, bootstrap))) {
      await recordFailedAuthAttempt(env, request);
      throw new ApiError(401, "unauthorized", "Invalid password");
    }
    await setAdminPassword(env, bootstrap);
    record = await getAdminAuth(env);
  }

  if (!record || !(await verifyPassword(password, record))) {
    await recordFailedAuthAttempt(env, request);
    throw new ApiError(401, "unauthorized", "Invalid password");
  }

  await clearAuthAttempt(env, request);
  await deleteExpiredAdminSessions(env);

  const token = randomToken(SESSION_TOKEN_BYTES);
  const tokenHash = await sha256Base64(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO admin_sessions (token_hash, expires_at, created_at, last_seen_at)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  )
    .bind(tokenHash, expiresAt)
    .run();

  return token;
}

export async function destroyAdminSession(env: RuntimeEnv, request: Request): Promise<void> {
  await ensureDatabaseSchema(env);
  const token = extractSessionToken(request);
  if (!token) return;
  await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256Base64(token)).run();
}

export function adminSessionCookie(token: string, request: Request): string {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  return cookieHeader(SESSION_COOKIE_NAME, token, maxAgeSeconds, request);
}

export function clearAdminSessionCookie(request: Request): string {
  return cookieHeader(SESSION_COOKIE_NAME, "", 0, request);
}

export async function requestAdminPasswordReset(
  env: RuntimeEnv,
  email: string,
  resetOrigin: string
): Promise<void> {
  await ensureDatabaseSchema(env);
  const record = await getAdminAuth(env);
  const normalizedEmail = normalizeAdminEmail(email);

  if (!record?.admin_email || record.admin_email !== normalizedEmail) {
    return;
  }

  const token = randomResetToken();
  const tokenHash = await sha256Base64(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  const resetUrl = new URL("/reset", resetOrigin);
  resetUrl.searchParams.set("token", token);

  await env.DB.prepare(
    `UPDATE admin_auth
     SET reset_token_hash = ?, reset_expires_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = 'primary'`
  )
    .bind(tokenHash, expiresAt)
    .run();

  await sendPasswordResetEmail(env, record, resetUrl.toString()).catch((error) => {
    console.error("Failed to send password reset email", error);
  });
}

export async function confirmAdminPasswordReset(
  env: RuntimeEnv,
  input: { token: string; password: string }
): Promise<void> {
  await ensureDatabaseSchema(env);
  const record = await getAdminAuth(env);
  const token = input.token.trim();
  if (!record?.reset_token_hash || !record.reset_expires_at || token.length < 24) {
    throw new ApiError(400, "invalid_reset_token", "Reset token is invalid or expired");
  }

  if (Date.parse(record.reset_expires_at) < Date.now()) {
    await clearResetToken(env);
    throw new ApiError(400, "invalid_reset_token", "Reset token is invalid or expired");
  }

  const tokenHash = await sha256Base64(token);
  if (!secureStringEqual(tokenHash, record.reset_token_hash)) {
    throw new ApiError(400, "invalid_reset_token", "Reset token is invalid or expired");
  }

  await setAdminPassword(env, input.password);
  await clearResetToken(env);
}

function extractPassword(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7);
  }

  const headerPassword = request.headers.get("x-admin-password");
  if (headerPassword) {
    return headerPassword;
  }

  return null;
}

async function bootstrapPassword(env: RuntimeEnv, provided: string | null, request: Request): Promise<void> {
  const bootstrap = configuredAdminPassword(env);
  if (!bootstrap) {
    throw new ApiError(409, "setup_required", "Create the first admin account before logging in.");
  }

  await enforceAuthRateLimit(env, request);
  if (!provided || !(await securePlainEqual(provided, bootstrap))) {
    await recordFailedAuthAttempt(env, request);
    throw new ApiError(401, "unauthorized", "Invalid password");
  }

  await setAdminPassword(env, bootstrap);
  await clearAuthAttempt(env, request);
}

async function enforceAuthRateLimit(env: RuntimeEnv, request: Request): Promise<void> {
  const row = await getAuthAttempt(env, await authAttemptKey(request));
  if (!row?.locked_until) return;

  if (Date.parse(row.locked_until) > Date.now()) {
    throw new ApiError(429, "auth_locked", "Too many failed login attempts. Try again later.");
  }
}

async function recordFailedAuthAttempt(env: RuntimeEnv, request: Request): Promise<void> {
  const key = await authAttemptKey(request);
  const existing = await getAuthAttempt(env, key);
  const now = Date.now();
  const recent = existing?.updated_at ? now - Date.parse(existing.updated_at) <= AUTH_FAILURE_WINDOW_MS : false;
  const failures = recent && existing ? existing.failures + 1 : 1;
  const lockedUntil = failures >= AUTH_MAX_FAILURES ? new Date(now + AUTH_LOCK_MS).toISOString() : null;
  const updatedAt = new Date(now).toISOString();

  await env.DB.prepare(
    `INSERT INTO auth_attempts (key, failures, locked_until, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       failures = excluded.failures,
       locked_until = excluded.locked_until,
       updated_at = excluded.updated_at`
  )
    .bind(key, failures, lockedUntil, updatedAt)
    .run();
}

async function clearAuthAttempt(env: RuntimeEnv, request: Request): Promise<void> {
  await env.DB.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(await authAttemptKey(request)).run();
}

async function verifyAdminSession(env: RuntimeEnv, token: string): Promise<boolean> {
  const tokenHash = await sha256Base64(token);
  const row =
    (await env.DB.prepare("SELECT token_hash, expires_at FROM admin_sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .first<AdminSessionRow>()) ?? null;
  if (!row) return false;

  if (Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return false;
  }

  await env.DB.prepare("UPDATE admin_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?").bind(tokenHash).run();
  return secureStringEqual(tokenHash, row.token_hash);
}

async function clearAdminSessions(env: RuntimeEnv): Promise<void> {
  await env.DB.prepare("DELETE FROM admin_sessions").run();
}

async function deleteExpiredAdminSessions(env: RuntimeEnv): Promise<void> {
  await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(new Date().toISOString()).run();
}

async function getAuthAttempt(env: RuntimeEnv, key: string): Promise<AuthAttemptRow | null> {
  return (await env.DB.prepare("SELECT failures, locked_until, updated_at FROM auth_attempts WHERE key = ?").bind(key).first<AuthAttemptRow>()) ?? null;
}

async function authAttemptKey(request: Request): Promise<string> {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  return `auth:${await sha256Base64(ip)}`;
}

async function getAdminAuth(env: RuntimeEnv): Promise<AdminAuthRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT password_hash, password_salt, password_iterations,
        admin_name, admin_email, reset_token_hash, reset_expires_at
       FROM admin_auth WHERE id = 'primary'`
    ).first<AdminAuthRow>()) ?? null
  );
}

async function clearResetToken(env: RuntimeEnv): Promise<void> {
  await env.DB.prepare(
    `UPDATE admin_auth
     SET reset_token_hash = NULL, reset_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = 'primary'`
  ).run();
}

async function verifyPassword(password: string, record: AdminAuthRow): Promise<boolean> {
  const hash = await hashPassword(password, record.password_salt, record.password_iterations);
  return secureStringEqual(hash, record.password_hash);
}

async function hashPassword(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToArrayBuffer(salt),
      iterations
    },
    key,
    256
  );

  return bytesToBase64(new Uint8Array(bits));
}

async function securePlainEqual(provided: string, expected: string): Promise<boolean> {
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);

  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  return secureBytesEqual(left, right) && provided.length === expected.length;
}

async function sha256Base64(value: string): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function secureStringEqual(left: string, right: string): boolean {
  return secureBytesEqual(encoder.encode(left), encoder.encode(right)) && left.length === right.length;
}

function secureBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = 0;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return diff === 0 && left.length === right.length;
}

function randomSalt(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return bytesToBase64(salt);
}

function randomResetToken(): string {
  return randomToken(RESET_TOKEN_BYTES);
}

function randomToken(size: number): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function extractSessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === SESSION_COOKIE_NAME) {
      const value = rawValue.join("=");
      return value || null;
    }
  }
  return null;
}

function cookieHeader(name: string, value: string, maxAgeSeconds: number, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
    secure
  ]
    .filter(Boolean)
    .join("; ");
}

function validatePassword(password: string): void {
  if (password.length < 12) {
    throw new ApiError(400, "weak_password", "Password must be at least 12 characters");
  }
}

function normalizeAdminName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 160) {
    throw new ApiError(400, "invalid_name", "Name is invalid");
  }
  return name;
}

function normalizeAdminEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "invalid_email", "Email address is invalid");
  }
  return email;
}

function validateExternalRecoveryEmail(email: string, primaryDomainInput: string): void {
  const primaryDomain = normalizeDomain(primaryDomainInput);
  const recoveryDomain = domainFromEmail(email);
  if (
    recoveryDomain === primaryDomain ||
    recoveryDomain.endsWith(`.${primaryDomain}`) ||
    primaryDomain.endsWith(`.${recoveryDomain}`)
  ) {
    throw new ApiError(400, "recovery_email_not_external", "Recovery email must be outside the primary domain");
  }
}

async function sendPasswordResetEmail(env: RuntimeEnv, record: AdminAuthRow, resetUrl: string): Promise<void> {
  const to = record.admin_email;
  const from = env.PASSWORD_RESET_FROM?.trim() || (await defaultResetSender(env));
  if (!to || !from) {
    throw new ApiError(500, "reset_email_unconfigured", "Password reset sender is not configured");
  }

  const name = record.admin_name ?? "admin";
  const text = [
    `Hello ${name},`,
    "",
    "Use this link to reset your OmniDock password:",
    resetUrl,
    "",
    "This link expires in 30 minutes."
  ].join("\n");

  await env.EMAIL.send({
    from,
    to,
    subject: "OmniDock password reset",
    text,
    html: `<p>Hello ${escapeHtml(name)},</p><p>Use this link to reset your OmniDock password:</p><p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p><p>This link expires in 30 minutes.</p>`
  });
}

async function defaultResetSender(env: RuntimeEnv): Promise<string> {
  const domain = await getDefaultDomain(env);
  return domain ? `omnidock@${domain.domain}` : "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
