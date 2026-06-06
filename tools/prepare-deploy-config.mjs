import fs from "node:fs";

const CONFIG_PATH = envValue("OMNIDOCK_CONFIG_PATH", "EMAILFOX_CONFIG_PATH") || "wrangler.jsonc";
const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";
const PLACEHOLDER_R2_BUCKETS = new Set(["omnidock-mail", "emailfox-mail"]);

const d1DatabaseId = envValue("OMNIDOCK_D1_DATABASE_ID", "EMAILFOX_D1_DATABASE_ID");
const d1DatabaseName = envValue("OMNIDOCK_D1_DATABASE_NAME", "EMAILFOX_D1_DATABASE_NAME") || "omnidock-db";
const r2BucketName = envValue("OMNIDOCK_R2_BUCKET_NAME", "EMAILFOX_R2_BUCKET_NAME");

const config = readJsonc(CONFIG_PATH);
let changed = false;

if (d1DatabaseId && d1DatabaseId !== PLACEHOLDER_D1_ID) {
  config.d1_databases = [
    {
      binding: "DB",
      database_name: d1DatabaseName,
      database_id: d1DatabaseId,
      migrations_dir: "migrations"
    }
  ];
  changed = true;
} else if (removeD1Placeholder(config)) {
  changed = true;
  console.warn("OmniDock removed the public DB placeholder from this deploy config.");
}

if (r2BucketName) {
  config.r2_buckets = [
    {
      binding: "MAIL_BUCKET",
      bucket_name: r2BucketName
    }
  ];
  changed = true;
} else if (removeR2Placeholder(config)) {
  changed = true;
  console.warn("OmniDock removed the public MAIL_BUCKET placeholder from this deploy config.");
}

if (changed) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`OmniDock prepared ${CONFIG_PATH} for this build.`);
}

function removeD1Placeholder(config) {
  if (!Array.isArray(config.d1_databases)) return false;
  const next = config.d1_databases.filter(
    (item) => !(item?.binding === "DB" && (!item.database_id || item.database_id === PLACEHOLDER_D1_ID))
  );
  if (next.length === config.d1_databases.length) return false;
  if (next.length > 0) {
    config.d1_databases = next;
  } else {
    delete config.d1_databases;
  }
  return true;
}

function removeR2Placeholder(config) {
  if (!Array.isArray(config.r2_buckets)) return false;
  const next = config.r2_buckets.filter(
    (item) => !(item?.binding === "MAIL_BUCKET" && (!item.bucket_name || PLACEHOLDER_R2_BUCKETS.has(item.bucket_name)))
  );
  if (next.length === config.r2_buckets.length) return false;
  if (next.length > 0) {
    config.r2_buckets = next;
  } else {
    delete config.r2_buckets;
  }
  return true;
}

function envValue(name, legacyName) {
  return process.env[name]?.trim() || (legacyName ? process.env[legacyName]?.trim() : "") || "";
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
