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
const preservedResourceBindings = new Set();

if (process.env.EMAILFOX_D1_DATABASE_ID?.trim()) {
  generatedConfig.d1_databases = [
    {
      binding: "DB",
      database_name: process.env.EMAILFOX_D1_DATABASE_NAME?.trim() || "emailfox-db",
      database_id: process.env.EMAILFOX_D1_DATABASE_ID.trim(),
      migrations_dir: "migrations"
    }
  ];
  preservedResourceBindings.add("DB");
}

if (process.env.EMAILFOX_R2_BUCKET_NAME?.trim()) {
  generatedConfig.r2_buckets = [
    {
      binding: "MAIL_BUCKET",
      bucket_name: process.env.EMAILFOX_R2_BUCKET_NAME.trim()
    }
  ];
  preservedResourceBindings.add("MAIL_BUCKET");
}

if (token && workerName) {
  try {
    const accountId = await configuredAccountId(token);
    if (accountId) {
      const bindings = await fetchWorkerBindings(token, accountId, workerName);
      for (const bindingName of mergeCloudflareBindings(generatedConfig, bindings)) {
        preservedResourceBindings.add(bindingName);
      }
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

const requiredResourceBindings = ["DB", "MAIL_BUCKET"];
const missingResourceBindings = requiredResourceBindings.filter((binding) => !preservedResourceBindings.has(binding));
if (missingResourceBindings.length > 0) {
  const existingWorker = remoteWorkerHasDeployments(workerName);
  const allowUnboundDeploy = process.env.EMAILFOX_ALLOW_UNBOUND_DEPLOY === "1";

  if ((existingWorker === true || existingWorker === null) && !allowUnboundDeploy) {
    console.error("Emailfox stopped this deploy before Wrangler could remove dashboard resource bindings.");
    console.error(`Missing generated binding(s): ${missingResourceBindings.join(", ")}`);
    console.error("Add EMAILFOX_D1_DATABASE_ID and EMAILFOX_R2_BUCKET_NAME as Cloudflare build/deploy variables or secrets, then deploy again.");
    console.error("Alternatively expose CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to the build so Emailfox can read existing Worker bindings.");
    console.error("Set EMAILFOX_ALLOW_UNBOUND_DEPLOY=1 only for an intentional first deploy without D1/R2 bindings.");
    process.exit(1);
  }

  console.warn(`Emailfox deploy is missing generated resource binding(s): ${missingResourceBindings.join(", ")}.`);
  console.warn("This is allowed only because the remote Worker has no detected deployments or EMAILFOX_ALLOW_UNBOUND_DEPLOY=1 is set.");
} else {
  console.log(`Emailfox preserved ${preservedResourceBindings.size} DB/R2 binding(s) for this deploy.`);
}

const result = spawnSync("npx", args, { stdio: "inherit" });
process.exit(result.status ?? 1);

function mergeCloudflareBindings(config, bindings) {
  const preserved = [];
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
    preserved.push("DB");
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
    preserved.push("MAIL_BUCKET");
  }

  return preserved;
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
    `/accounts/${accountId}/workers/scripts/${encodedScript}/settings`
  );
  return Array.isArray(response.result?.bindings) ? response.result.bindings : [];
}

function remoteWorkerHasDeployments(scriptName) {
  if (!scriptName) return null;

  const result = spawnSync("npx", ["wrangler", "deployments", "list", "--name", scriptName, "--json"], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    if (/not found|does not exist|could not find|not exist/i.test(output)) {
      return false;
    }
    if (output) {
      console.warn(`Emailfox could not inspect existing Worker deployments: ${firstLine(output)}`);
    }
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout || "[]");
    if (Array.isArray(parsed)) {
      return parsed.length > 0;
    }
    if (Array.isArray(parsed.result)) {
      return parsed.result.length > 0;
    }
    if (Array.isArray(parsed.deployments)) {
      return parsed.deployments.length > 0;
    }
  } catch (error) {
    console.warn(`Emailfox could not parse existing Worker deployments: ${readError(error)}`);
    return null;
  }

  return null;
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

function firstLine(value) {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? value;
}
