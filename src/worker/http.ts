export type RuntimeEnv = Env & {
  ADMIN_PASSWORD?: string;
  AI?: Ai;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  DB: D1Database;
  DOMAINS?: string;
  ENABLE_DEV_SEED?: string;
  EMAIL: SendEmail;
  EXTRA_R2_BUCKETS?: string;
  MAIL_BUCKET: R2Bucket;
  MANAGEMENT_HOST?: string;
  PRIMARY_DOMAIN?: string;
  PASSWORD_RESET_FROM?: string;
  R2_BUCKET_NAME?: string;
  WORKER_SCRIPT_NAME?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  applySecurityHeaders(headers);

  return new Response(JSON.stringify(data), {
    ...init,
    headers
  });
}

export function noContent(): Response {
  return withSecurityHeaders(new Response(null, { status: 204 }));
}

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function applySecurityHeaders(headers: Headers): void {
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set(
    "content-security-policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join("; ")
  );
}

export async function readJson(request: Request, maxBytes = 1024 * 1024): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Expected application/json");
  }

  const body = await readBoundedJson(request, maxBytes).catch((error: unknown) => {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_json", "Body must be valid JSON");
  });

  if (!isRecord(body)) {
    throw new ApiError(400, "invalid_body", "Body must be a JSON object");
  }

  return body;
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > maxBytes) {
    await request.body?.cancel();
    throw new ApiError(413, "body_too_large", "Request body is too large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing JSON body");
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "body_too_large", "Request body is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

export function requiredString(
  body: Record<string, unknown>,
  field: string,
  options: { min?: number; max?: number } = {}
): string {
  const value = body[field];
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_field", `${field} must be a string`);
  }

  const trimmed = value.trim();
  const min = options.min ?? 1;
  const max = options.max ?? 1000;

  if (trimmed.length < min || trimmed.length > max) {
    throw new ApiError(400, "invalid_field", `${field} length is invalid`);
  }

  return trimmed;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  options: { max?: number } = {}
): string | null {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_field", `${field} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length > (options.max ?? 1000)) {
    throw new ApiError(400, "invalid_field", `${field} is too long`);
  }

  return trimmed;
}

export function optionalBoolean(body: Record<string, unknown>, field: string): boolean {
  const value = body[field];
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new ApiError(400, "invalid_field", `${field} must be a boolean`);
  }

  return value;
}

export function stringList(body: Record<string, unknown>, field: string): string[] {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (typeof value === "string") {
    return splitAddresses(value);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item !== "string") {
        throw new ApiError(400, "invalid_field", `${field} must contain strings`);
      }
      return splitAddresses(item);
    });
  }

  throw new ApiError(400, "invalid_field", `${field} must be a string or string array`);
}

export function splitAddresses(value: string): string[] {
  return value
    .split(/[,\n;]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      { status: error.status }
    );
  }

  const databaseError = databaseReadinessError(error);
  if (databaseError) {
    console.error(error);
    return json(
      {
        ok: false,
        error: databaseError
      },
      { status: databaseError.status }
    );
  }

  console.error(error);
  return json(
    {
      ok: false,
      error: {
        code: "internal_error",
        message: "Internal server error"
      }
    },
    { status: 500 }
  );
}

function databaseReadinessError(error: unknown): { status: number; code: string; message: string } | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.toLowerCase();
  if (message.includes("no such table") || message.includes("no such column")) {
    return {
      status: 503,
      code: "database_migration_required",
      message: "D1 database is not ready. Run remote migrations, then try logging in again."
    };
  }

  if (message.includes("cannot read properties of undefined") && message.includes("prepare")) {
    return {
      status: 503,
      code: "database_binding_missing",
      message: "D1 binding DB is not configured for this Worker."
    };
  }

  return null;
}

export function methodNotAllowed(): Response {
  return json(
    {
      ok: false,
      error: {
        code: "method_not_allowed",
        message: "Method not allowed"
      }
    },
    { status: 405 }
  );
}
