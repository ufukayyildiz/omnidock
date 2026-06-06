import fs from "node:fs";

const SKIP_FLAG = "EMAILFOX_SKIP_CONFIG_CHECK";
const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";

if (process.env[SKIP_FLAG] === "1") {
  process.exit(0);
}

const config = readJsonc("wrangler.jsonc");
const failures = [];

const d1 = Array.isArray(config.d1_databases) ? config.d1_databases.find((item) => item.binding === "DB") : null;
if (!d1?.database_name) {
  failures.push("Set d1_databases binding DB with a database_name so Cloudflare can create or reuse D1.");
}
if (!d1?.database_id || d1.database_id === PLACEHOLDER_D1_ID) {
  failures.push("Select or create the D1 database during deploy so DB.database_id is not the placeholder UUID.");
}

const r2 = Array.isArray(config.r2_buckets) ? config.r2_buckets.find((item) => item.binding === "MAIL_BUCKET") : null;
if (!r2?.bucket_name) {
  failures.push("Set r2_buckets binding MAIL_BUCKET with a bucket_name so Cloudflare can create or reuse R2.");
}

if (failures.length > 0) {
  console.error("Emailfox deploy configuration is incomplete:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(`Set ${SKIP_FLAG}=1 only when developing the public template itself.`);
  process.exit(1);
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
