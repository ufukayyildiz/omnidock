export type RuntimeEnv = Env & {
  ADMIN_PASSWORD_BOOTSTRAP?: string;
  CLOUDFLARE_API_TOKEN?: string;
  ENABLE_DEV_SEED?: string;
  PASSWORD_RESET_FROM?: string;
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

  return new Response(JSON.stringify(data), {
    ...init,
    headers
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Expected application/json");
  }

  const body = await request.json().catch(() => {
    throw new ApiError(400, "invalid_json", "Body must be valid JSON");
  });

  if (!isRecord(body)) {
    throw new ApiError(400, "invalid_body", "Body must be a JSON object");
  }

  return body;
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
