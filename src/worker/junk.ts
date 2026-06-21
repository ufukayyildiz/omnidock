type ParsedHeader = {
  key: string;
  value: string;
};

export type JunkClassification = {
  junk: boolean;
  score: number;
  reasons: string[];
};

export function classifyJunkMail(input: {
  headers?: Headers | null;
  parsedHeaders?: ParsedHeader[] | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
}): JunkClassification {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string): void => {
    score += points;
    reasons.push(reason);
  };

  const spamFlag = headerValue(input, "x-spam-flag").toLowerCase();
  if (/\byes\b/.test(spamFlag)) add(8, "x-spam-flag");

  const spamStatus = headerValue(input, "x-spam-status").toLowerCase();
  if (/^\s*yes\b/.test(spamStatus) || /\bspam\b/.test(spamStatus)) add(8, "x-spam-status");

  const spamLevel = headerValue(input, "x-spam-level");
  if ((spamLevel.match(/\*/g)?.length ?? 0) >= 5) add(5, "x-spam-level");

  const numericScore = firstNumericHeader(input, ["x-spam-score", "x-rspamd-score", "x-cf-spam-score"]);
  if (numericScore !== null) {
    if (numericScore >= 5) add(5, "spam-score");
    else if (numericScore >= 3) add(2, "spam-score");
  }

  const authResults = headerValue(input, "authentication-results").toLowerCase();
  const dmarcFail = /\bdmarc=(fail|permerror|temperror)\b/.test(authResults);
  const spfFail = /\bspf=(fail|softfail|permerror|temperror)\b/.test(authResults);
  const dkimFail = /\bdkim=(fail|permerror|temperror)\b/.test(authResults);
  if (dmarcFail && (spfFail || dkimFail)) add(4, "auth-fail");

  const content = `${input.subject ?? ""}\n${input.text ?? ""}\n${stripHtml(input.html ?? "")}`.toLowerCase();
  const keywordHits = [
    /\bviagra\b/,
    /\bcasino\b/,
    /\blottery\b/,
    /\bfree money\b/,
    /\bwinner\b/,
    /\bcrypto airdrop\b/,
    /\binvestment opportunity\b/,
    /\bact now\b/
  ].filter((pattern) => pattern.test(content)).length;
  if (keywordHits >= 2) add(3, "spam-keywords");

  return {
    junk: score >= 5,
    score,
    reasons
  };
}

function headerValue(input: { headers?: Headers | null; parsedHeaders?: ParsedHeader[] | null }, name: string): string {
  const normalized = name.toLowerCase();
  const direct = input.headers?.get(name) ?? "";
  const parsed = (input.parsedHeaders ?? [])
    .filter((header) => header.key.toLowerCase() === normalized)
    .map((header) => header.value)
    .join("\n");
  return [direct, parsed].filter(Boolean).join("\n");
}

function firstNumericHeader(
  input: { headers?: Headers | null; parsedHeaders?: ParsedHeader[] | null },
  names: string[]
): number | null {
  for (const name of names) {
    const raw = headerValue(input, name).match(/-?\d+(?:\.\d+)?/)?.[0];
    if (!raw) continue;
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function stripHtml(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
}
