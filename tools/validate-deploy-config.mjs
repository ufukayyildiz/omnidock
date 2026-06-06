import fs from "node:fs";

const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";
const PLACEHOLDER_R2_BUCKETS = new Set(["omnidock-mail", "emailfox-mail"]);

const config = readJsonc("wrangler.jsonc");
const warnings = [];

const d1 = Array.isArray(config.d1_databases) ? config.d1_databases.find((item) => item.binding === "DB") : null;
if (!d1) {
  warnings.push("DB binding is not in the deploy config. First deploy can continue, but set OMNIDOCK_D1_DATABASE_ID before normal Git updates.");
} else if (!d1.database_id || d1.database_id === PLACEHOLDER_D1_ID) {
  warnings.push("DB.database_id is still the public placeholder. OmniDock will remove it unless OMNIDOCK_D1_DATABASE_ID is set.");
}

const r2 = Array.isArray(config.r2_buckets) ? config.r2_buckets.find((item) => item.binding === "MAIL_BUCKET") : null;
if (!r2) {
  warnings.push("MAIL_BUCKET binding is not in the deploy config. First deploy can continue, but set OMNIDOCK_R2_BUCKET_NAME before normal Git updates.");
} else if (!r2.bucket_name || PLACEHOLDER_R2_BUCKETS.has(r2.bucket_name)) {
  warnings.push("MAIL_BUCKET uses the public placeholder bucket name. OmniDock will remove it unless OMNIDOCK_R2_BUCKET_NAME is set.");
}

if (warnings.length > 0) {
  const strict = envFlag("OMNIDOCK_STRICT_CONFIG_CHECK") || envFlag("EMAILFOX_STRICT_CONFIG_CHECK");
  const output = strict ? console.error : console.warn;
  output("OmniDock deploy configuration warning:");
  for (const warning of warnings) {
    output(`- ${warning}`);
  }
  output("The Worker will show setup requirements at runtime until DB and MAIL_BUCKET are connected.");
  if (strict) {
    process.exit(1);
  }
}

function envFlag(name) {
  return process.env[name] === "1";
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
