import { spawnSync } from "node:child_process";
import fs from "node:fs";

const CONFIG_PATH = "wrangler.jsonc";
const GENERATED_CONFIG_PATH = ".wrangler.emailfox.generated.jsonc";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

const baseConfig = readJsonc(CONFIG_PATH);
const generatedConfig = structuredClone(baseConfig);
generatedConfig.keep_vars = true;

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const workerName = process.env.WORKER_SCRIPT_NAME?.trim() || generatedConfig.name;
let preservedBindings = 0;

if (process.env.EMAILFOX_D1_DATABASE_ID?.trim()) {
  generatedConfig.d1_databases = [
    {
      binding: "DB",
      database_name: process.env.EMAILFOX_D1_DATABASE_NAME?.trim() || "emailfox-db",
      database_id: process.env.EMAILFOX_D1_DATABASE_ID.trim(),
      migrations_dir: "migrations"
    }
  ];
  preservedBindings += 1;
}

if (process.env.EMAILFOX_R2_BUCKET_NAME?.trim()) {
  generatedConfig.r2_buckets = [
    {
      binding: "MAIL_BUCKET",
      bucket_name: process.env.EMAILFOX_R2_BUCKET_NAME.trim()
    }
  ];
  preservedBindings += 1;
}

if (token && workerName) {
  try {
    const accountId = await configuredAccountId(token);
    if (accountId) {
      const bindings = await fetchWorkerBindings(token, accountId, workerName);
      preservedBindings += mergeCloudflareBindings(generatedConfig, bindings);
    }
  } catch (error) {
    console.warn(`Emailfox could not read existing Worker bindings: ${readError(error)}`);
  }
} else {
  console.warn("Emailfox could not read existing Worker bindings because CLOUDFLARE_API_TOKEN is not available at build time.");
}

fs.writeFileSync(GENERATED_CONFIG_PATH, `${JSON.stringify(generatedConfig, null, 2)}\n`);

const dryRun = process.env.EMAILFOX_DEPLOY_DRY_RUN === "1";
const args = ["wrangler", "deploy", "--config", GENERATED_CONFIG_PATH, "--keep-vars"];
if (dryRun) {
  args.push("--dry-run");
}
if (preservedBindings === 0) {
  args.push("--strict");
  console.warn("Emailfox did not preserve remote DB/MAIL_BUCKET bindings. Deploying in strict mode to avoid silently removing dashboard bindings.");
} else {
  console.log(`Emailfox preserved ${preservedBindings} DB/R2 binding(s) for this deploy.`);
}

const result = spawnSync("npx", args, { stdio: "inherit" });
process.exit(result.status ?? 1);

function mergeCloudflareBindings(config, bindings) {
  let count = 0;
  const d1 = bindings.find((binding) => binding.type === "d1" && binding.name === "DB" && binding.id);
  if (d1) {
    config.d1_databases = [
      {
        binding: "DB",
        database_name: d1.database_name || "emailfox-db",
        database_id: d1.id,
        migrations_dir: "migrations"
      }
    ];
    count += 1;
  }

  const r2 = bindings.find((binding) => binding.type === "r2_bucket" && binding.name === "MAIL_BUCKET" && binding.bucket_name);
  if (r2) {
    config.r2_buckets = [
      {
        binding: "MAIL_BUCKET",
        bucket_name: r2.bucket_name,
        ...(r2.jurisdiction ? { jurisdiction: r2.jurisdiction } : {})
      }
    ];
    count += 1;
  }

  return count;
}

async function configuredAccountId(tokenValue) {
  const configured = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (configured) return configured;

  const accounts = await cloudflare(tokenValue, "/accounts?per_page=2");
  const results = Array.isArray(accounts.result) ? accounts.result : [];
  if (results.length === 1 && results[0]?.id) {
    return results[0].id;
  }

  if (results.length > 1) {
    console.warn("Emailfox API token can access multiple Cloudflare accounts. Set CLOUDFLARE_ACCOUNT_ID as a build variable to preserve bindings.");
  }

  return null;
}

async function fetchWorkerBindings(tokenValue, accountId, scriptName) {
  const encodedScript = encodeURIComponent(scriptName);
  const response = await cloudflare(
    tokenValue,
    `/accounts/${accountId}/workers/services/${encodedScript}/environments/production/bindings`
  );
  return Array.isArray(response.result) ? response.result : [];
}

async function cloudflare(tokenValue, path) {
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    headers: {
      authorization: `Bearer ${tokenValue}`,
      accept: "application/json"
    }
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    const message = body?.errors?.[0]?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return body;
}

function readJsonc(path) {
  const source = fs.readFileSync(path, "utf8");
  return JSON.parse(stripJsonComments(source));
}

function stripJsonComments(source) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function readError(error) {
  return error instanceof Error ? error.message : String(error);
}
