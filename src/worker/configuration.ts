import { normalizeDomain } from "./db";
import { RuntimeEnv } from "./http";

export type RuntimeRequirement = {
  kind: "binding" | "secret" | "variable";
  name: string;
  required: boolean;
  configured: boolean;
  message: string;
};

export function configuredAdminPassword(env: RuntimeEnv): string {
  return (env.ADMIN_PASSWORD ?? env.ADMIN_PASSWORD_BOOTSTRAP ?? "").trim();
}

export function configuredPrimaryDomain(env: RuntimeEnv): string | null {
  const domain = (env.PRIMARY_DOMAIN ?? env.DOMAINS?.split(",")[0] ?? "").trim();
  if (!domain || domain.toLowerCase() === "example.com") {
    return null;
  }

  try {
    return normalizeDomain(domain);
  } catch {
    return null;
  }
}

export function runtimeRequirements(env: RuntimeEnv, setupRequired: boolean): RuntimeRequirement[] {
  return [
    {
      kind: "binding",
      name: "DB",
      required: true,
      configured: Boolean(env.DB),
      message: env.DB ? "D1 database binding DB is connected." : "Add a D1 database binding named DB."
    },
    {
      kind: "binding",
      name: "MAIL_BUCKET",
      required: true,
      configured: Boolean(env.MAIL_BUCKET),
      message: env.MAIL_BUCKET ? "R2 bucket binding MAIL_BUCKET is connected." : "Add an R2 bucket binding named MAIL_BUCKET."
    },
    {
      kind: "binding",
      name: "EMAIL",
      required: true,
      configured: Boolean(env.EMAIL),
      message: env.EMAIL ? "Email Sending binding EMAIL is connected." : "Add a Cloudflare Email Sending binding named EMAIL."
    },
    {
      kind: "secret",
      name: "ADMIN_PASSWORD",
      required: setupRequired,
      configured: Boolean(configuredAdminPassword(env)),
      message: configuredAdminPassword(env)
        ? "First admin password secret is configured."
        : "Add the first admin password as a Worker secret named ADMIN_PASSWORD."
    },
    {
      kind: "variable",
      name: "PRIMARY_DOMAIN",
      required: true,
      configured: Boolean(configuredPrimaryDomain(env)),
      message: configuredPrimaryDomain(env)
        ? "Primary domain variable is configured."
        : "Add the first managed email domain as a Worker variable named PRIMARY_DOMAIN."
    },
    {
      kind: "secret",
      name: "CLOUDFLARE_API_TOKEN",
      required: true,
      configured: Boolean(env.CLOUDFLARE_API_TOKEN),
      message: env.CLOUDFLARE_API_TOKEN
        ? "Cloudflare API token secret is configured."
        : "Add CLOUDFLARE_API_TOKEN to enable Cloudflare sync and routing automation."
    },
    {
      kind: "variable",
      name: "WORKER_SCRIPT_NAME",
      required: false,
      configured: Boolean(env.WORKER_SCRIPT_NAME),
      message: env.WORKER_SCRIPT_NAME
        ? "Worker script name variable is configured."
        : "Optional: add the deployed Worker script name as WORKER_SCRIPT_NAME."
    },
    {
      kind: "variable",
      name: "MANAGEMENT_HOST",
      required: false,
      configured: Boolean(env.MANAGEMENT_HOST),
      message: env.MANAGEMENT_HOST
        ? "Custom management host variable is configured."
        : "Optional: add this only when using a custom dashboard hostname."
    },
    {
      kind: "variable",
      name: "PASSWORD_RESET_FROM",
      required: false,
      configured: Boolean(env.PASSWORD_RESET_FROM),
      message: env.PASSWORD_RESET_FROM
        ? "Password reset sender variable is configured."
        : "Optional: add a verified sender address for password reset emails."
    },
    {
      kind: "variable",
      name: "CLOUDFLARE_ACCOUNT_ID",
      required: false,
      configured: Boolean(env.CLOUDFLARE_ACCOUNT_ID),
      message: env.CLOUDFLARE_ACCOUNT_ID
        ? "Cloudflare account id variable is configured."
        : "Optional: add this only if your API token can access multiple accounts."
    }
  ];
}
