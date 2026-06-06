import { ApiError, RuntimeEnv } from "./http";
import { ensureDatabaseSchema } from "./schema";
import { domainFromEmail, getDefaultDomain, normalizeDomain } from "./db";

const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 100_000;
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

type AdminAuthRow = {
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  admin_name: string | null;
  admin_email: string | null;
  reset_token_hash: string | null;
  reset_expires_at: string | null;
};

export type SetupStatus = {
  setupRequired: boolean;
  resetAvailable: boolean;
};

export async function requireAdmin(request: Request, env: RuntimeEnv): Promise<void> {
  await ensureDatabaseSchema(env);

  const provided = extractPassword(request);
  const record = await getAdminAuth(env);

  if (!record) {
    await bootstrapPassword(env, provided);
    return;
  }

  if (!provided || !(await verifyPassword(provided, record))) {
    throw new ApiError(401, "unauthorized", "Invalid password");
  }
}

export async function getSetupStatus(env: RuntimeEnv): Promise<SetupStatus> {
  await ensureDatabaseSchema(env);
  const record = await getAdminAuth(env);

  return {
    setupRequired: !record,
    resetAvailable: Boolean(record?.admin_email)
  };
}

export async function createAdminAccount(
  env: RuntimeEnv,
  input: { name: string; email: string; recoveryEmail: string; primaryDomain: string; password: string }
): Promise<void> {
  await ensureDatabaseSchema(env);
  const existing = await getAdminAuth(env);
  if (existing) {
    throw new ApiError(409, "setup_complete", "Admin account is already configured");
  }

  const name = normalizeAdminName(input.name);
  const email = normalizeAdminEmail(input.email);
  const recoveryEmail = normalizeAdminEmail(input.recoveryEmail);
  validateExternalRecoveryEmail(recoveryEmail, input.primaryDomain);
  validatePassword(input.password);

  const salt = randomSalt();
  const hash = await hashPassword(input.password, salt, PASSWORD_ITERATIONS);

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

async function bootstrapPassword(env: RuntimeEnv, provided: string | null): Promise<void> {
  const bootstrap = env.ADMIN_PASSWORD_BOOTSTRAP;
  if (!bootstrap) {
    throw new ApiError(409, "setup_required", "Create the first admin account before logging in.");
  }

  if (!provided || !(await securePlainEqual(provided, bootstrap))) {
    throw new ApiError(401, "unauthorized", "Invalid password");
  }

  await setAdminPassword(env, bootstrap);
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
  const bytes = new Uint8Array(RESET_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
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
    "Use this link to reset your Emailfox password:",
    resetUrl,
    "",
    "This link expires in 30 minutes."
  ].join("\n");

  await env.EMAIL.send({
    from,
    to,
    subject: "Emailfox password reset",
    text,
    html: `<p>Hello ${escapeHtml(name)},</p><p>Use this link to reset your Emailfox password:</p><p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p><p>This link expires in 30 minutes.</p>`
  });
}

async function defaultResetSender(env: RuntimeEnv): Promise<string> {
  const domain = await getDefaultDomain(env);
  return domain ? `emailfox@${domain.domain}` : "";
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
