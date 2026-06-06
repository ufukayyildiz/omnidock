import {
  createMailboxForDomain,
  getDomainById,
  getMailboxById,
  markMailboxRouting,
  recordAudit,
  upsertDomain
} from "./db";
import { ApiError, RuntimeEnv, isRecord } from "./http";

type CloudflareEnvelope<T> = {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: string[];
  result: T;
  result_info?: {
    page: number;
    total_pages: number;
  };
};

type CloudflareZone = {
  id: string;
  name: string;
  status?: string;
};

type CloudflareAccount = {
  id: string;
  name: string;
};

type RoutingStatus = {
  enabled?: boolean;
  status?: string;
};

type RoutingRule = {
  id?: string;
  name?: string;
  enabled?: boolean;
  matchers?: { type?: string; field?: string; value?: string }[];
  actions?: { type?: string; value?: string[] }[];
};

type SendingDomain = {
  id?: string;
  name?: string;
  domain?: string;
  status?: string;
  enabled?: boolean;
};

export async function syncCloudflareInventory(env: RuntimeEnv): Promise<{
  domains: number;
  warnings: string[];
}> {
  requireCloudflareConfig(env);

  const warnings: string[] = [];
  const accountId = await resolveAccountId(env);
  const zones = await listZones(env, accountId);
  const accountSending = await listAccountSendingDomains(env, accountId).catch((error: unknown) => {
    warnings.push(readErrorMessage(error));
    return [];
  });
  const sendingByDomain = new Map(
    accountSending
      .map((item) => [domainName(item), isActiveSending(item)] as const)
      .filter(([domain]) => Boolean(domain))
  );

  let count = 0;
  const syncedAt = new Date().toISOString();

  for (const zone of zones) {
    const routing = await getRoutingStatus(env, zone.id).catch((error: unknown) => {
      warnings.push(`${zone.name}: ${readErrorMessage(error)}`);
      return null;
    });
    const rules = await listRoutingRules(env, zone.id).catch(() => []);
    const zoneSending = await listZoneSendingDomains(env, zone.id).catch(() => []);

    for (const item of zoneSending) {
      const sendingDomain = domainName(item);
      if (sendingDomain) {
        sendingByDomain.set(sendingDomain, isActiveSending(item));
      }
    }

    const catchAll = rules.find((rule) => {
      const name = rule.name?.toLowerCase() ?? "";
      return name.includes("catch") || rule.matchers?.some((matcher) => matcher.type === "all");
    });

    await upsertDomain(env, {
      domain: zone.name,
      zoneId: zone.id,
      source: "cloudflare",
      sendingEnabled: sendingByDomain.get(zone.name) ?? false,
      routingEnabled: isActiveRouting(routing),
      catchAllEnabled: catchAll?.enabled === true,
      workerRuleId: catchAll?.id ?? null,
      status: zone.status ?? "cloudflare-zone",
      syncedAt
    });
    count += 1;
  }

  for (const [domain, sendingEnabled] of sendingByDomain) {
    await upsertDomain(env, {
      domain,
      source: "cloudflare",
      sendingEnabled,
      status: sendingEnabled ? "verified-sending" : "sending-pending",
      syncedAt
    });
    count += 1;
  }

  await recordAudit(env, "cloudflare.sync", null, { count, warnings });
  return { domains: count, warnings };
}

export async function enableCatchAllForDomain(
  env: RuntimeEnv,
  domainId: string
): Promise<{ ruleId: string | null }> {
  requireCloudflareConfig(env);
  const scriptName = workerScriptName(env);

  const domain = await getDomainById(env, domainId);
  if (!domain) {
    throw new ApiError(404, "domain_not_found", "Domain not found");
  }
  if (!domain.zone_id) {
    throw new ApiError(400, "zone_missing", "Domain does not have a Cloudflare zone id");
  }

  const result = await cfRequest<RoutingRule>(env, `/zones/${domain.zone_id}/email/routing/rules/catch_all`, {
    method: "PUT",
    body: JSON.stringify({
      name: "Emailfox catch-all",
      enabled: true,
      matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: [scriptName] }]
    })
  });

  await upsertDomain(env, {
    domain: domain.domain,
    zoneId: domain.zone_id,
    source: domain.source,
    sendingEnabled: domain.sending_enabled === 1,
    routingEnabled: true,
    catchAllEnabled: true,
    workerRuleId: result.id ?? domain.worker_rule_id,
    status: "routing-active",
    syncedAt: new Date().toISOString()
  });

  await recordAudit(env, "routing.catch_all_enabled", domain.id, { domain: domain.domain });
  return { ruleId: result.id ?? null };
}

export async function createMailboxAndRoutingRule(
  env: RuntimeEnv,
  input: { domainId: string; localPart: string; displayName: string | null; createRule: boolean }
): Promise<{ address: string; ruleId: string | null }> {
  const mailbox = await createMailboxForDomain(env, input.domainId, input.localPart, input.displayName);
  let ruleId: string | null = null;

  if (input.createRule) {
    const result = await enableRoutingForMailbox(env, mailbox.id);
    ruleId = result.ruleId;
  }

  await recordAudit(env, "mailbox.created", mailbox.id, {
    address: mailbox.address,
    routingRule: ruleId
  });

  return { address: mailbox.address, ruleId };
}

export async function enableRoutingForMailbox(
  env: RuntimeEnv,
  mailboxId: string
): Promise<{ ruleId: string | null }> {
  requireCloudflareConfig(env);
  const scriptName = workerScriptName(env);

  const mailbox = await getMailboxById(env, mailboxId);
  if (!mailbox) {
    throw new ApiError(404, "mailbox_not_found", "Mailbox not found");
  }

  if (mailbox.routing_enabled === 1 && mailbox.routing_rule_id) {
    return { ruleId: mailbox.routing_rule_id };
  }

  const domain = await getDomainById(env, mailbox.domain_id);
  if (!domain) {
    throw new ApiError(404, "domain_not_found", "Domain not found");
  }
  if (!domain.zone_id) {
    throw new ApiError(400, "zone_missing", "Domain does not have a Cloudflare zone id");
  }

  const existing = findMailboxRule(
    await listRoutingRules(env, domain.zone_id).catch(() => []),
    mailbox.address,
    scriptName
  );

  const rule =
    existing ??
    (await cfRequest<RoutingRule>(env, `/zones/${domain.zone_id}/email/routing/rules`, {
      method: "POST",
      body: JSON.stringify({
        name: `Emailfox ${mailbox.address}`,
        enabled: true,
        matchers: [{ type: "literal", field: "to", value: mailbox.address }],
        actions: [{ type: "worker", value: [scriptName] }]
      })
    }));

  const ruleId = rule.id ?? null;
  await markMailboxRouting(env, mailbox.id, ruleId);
  await upsertDomain(env, {
    domain: domain.domain,
    zoneId: domain.zone_id,
    source: domain.source,
    sendingEnabled: domain.sending_enabled === 1,
    routingEnabled: true,
    catchAllEnabled: domain.catch_all_enabled === 1,
    workerRuleId: ruleId ?? domain.worker_rule_id,
    status: "routing-active",
    syncedAt: new Date().toISOString()
  });
  await recordAudit(env, "routing.mailbox_enabled", mailbox.id, { address: mailbox.address, ruleId });

  return { ruleId };
}

async function listZones(env: RuntimeEnv, accountId: string): Promise<CloudflareZone[]> {
  const zones: CloudflareZone[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const envelope = await cfEnvelope<CloudflareZone[]>(
      env,
      `/zones?account.id=${encodeURIComponent(accountId)}&per_page=50&page=${page}`
    );
    zones.push(...envelope.result);
    totalPages = envelope.result_info?.total_pages ?? 1;
    page += 1;
  } while (page <= totalPages);

  return zones;
}

async function getRoutingStatus(env: RuntimeEnv, zoneId: string): Promise<RoutingStatus> {
  return cfRequest<RoutingStatus>(env, `/zones/${zoneId}/email/routing`);
}

async function listRoutingRules(env: RuntimeEnv, zoneId: string): Promise<RoutingRule[]> {
  return cfRequest<RoutingRule[]>(env, `/zones/${zoneId}/email/routing/rules`);
}

async function listAccountSendingDomains(env: RuntimeEnv, accountId: string): Promise<SendingDomain[]> {
  return cfRequest<SendingDomain[]>(env, `/accounts/${accountId}/email/sending/domains`);
}

async function listZoneSendingDomains(env: RuntimeEnv, zoneId: string): Promise<SendingDomain[]> {
  return cfRequest<SendingDomain[]>(env, `/zones/${zoneId}/email/sending/subdomains`);
}

async function cfRequest<T>(env: RuntimeEnv, path: string, init: RequestInit = {}): Promise<T> {
  const envelope = await cfEnvelope<T>(env, path, init);
  return envelope.result;
}

async function cfEnvelope<T>(
  env: RuntimeEnv,
  path: string,
  init: RequestInit = {}
): Promise<CloudflareEnvelope<T>> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  const payload = await response.json().catch(() => null);
  if (!isRecord(payload)) {
    throw new ApiError(response.status, "cloudflare_invalid_response", "Cloudflare returned an invalid response");
  }

  const envelope = payload as CloudflareEnvelope<T>;
  if (!response.ok || envelope.success === false) {
    const message = envelope.errors?.[0]?.message ?? `Cloudflare API request failed with ${response.status}`;
    throw new ApiError(response.status, "cloudflare_api_error", message);
  }

  return envelope;
}

function requireCloudflareConfig(env: RuntimeEnv): void {
  if (!env.CLOUDFLARE_API_TOKEN) {
    throw new ApiError(
      428,
      "cloudflare_token_missing",
      "Cloudflare automation is not configured. Add CLOUDFLARE_API_TOKEN as a Worker secret to enable sync and routing rules."
    );
  }
}

function workerScriptName(env: RuntimeEnv): string {
  const scriptName = env.WORKER_SCRIPT_NAME?.trim();
  if (!scriptName) {
    throw new ApiError(
      428,
      "worker_name_missing",
      "Routing automation needs WORKER_SCRIPT_NAME. Add it as a Worker variable with the deployed Worker script name."
    );
  }
  return scriptName;
}

async function resolveAccountId(env: RuntimeEnv): Promise<string> {
  const configured = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (configured && !configured.startsWith("replace-")) {
    return configured;
  }

  const accounts = await listAccounts(env);
  if (accounts.length === 1) {
    return accounts[0].id;
  }

  if (accounts.length === 0) {
    throw new ApiError(
      500,
      "cloudflare_account_missing",
      "Cloudflare API token cannot list any accounts. Add Account read permission or set CLOUDFLARE_ACCOUNT_ID as a Worker variable."
    );
  }

  throw new ApiError(
    400,
    "cloudflare_account_ambiguous",
    `Cloudflare API token can access ${accounts.length} accounts. Set CLOUDFLARE_ACCOUNT_ID as a Worker variable to choose one.`
  );
}

async function listAccounts(env: RuntimeEnv): Promise<CloudflareAccount[]> {
  const accounts: CloudflareAccount[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const envelope = await cfEnvelope<CloudflareAccount[]>(env, `/accounts?per_page=50&page=${page}`);
    accounts.push(...envelope.result);
    totalPages = envelope.result_info?.total_pages ?? 1;
    page += 1;
  } while (page <= totalPages);

  return accounts;
}

function domainName(input: SendingDomain): string {
  return (input.name ?? input.domain ?? "").toLowerCase();
}

function isActiveSending(input: SendingDomain): boolean {
  const status = input.status?.toLowerCase() ?? "";
  return input.enabled === true || ["active", "verified", "ready", "complete"].includes(status);
}

function isActiveRouting(input: RoutingStatus | null): boolean {
  const status = input?.status?.toLowerCase() ?? "";
  return input?.enabled === true || ["active", "enabled", "ready"].includes(status);
}

function findMailboxRule(rules: RoutingRule[], address: string, workerName: string): RoutingRule | null {
  const normalizedAddress = address.toLowerCase();
  return (
    rules.find((rule) => {
      const routesToMailbox = rule.matchers?.some(
        (matcher) =>
          matcher.type === "literal" &&
          matcher.field === "to" &&
          matcher.value?.toLowerCase() === normalizedAddress
      );
      const routesToWorker = rule.actions?.some(
        (action) => action.type === "worker" && action.value?.includes(workerName)
      );

      return rule.enabled !== false && routesToMailbox === true && routesToWorker === true;
    }) ?? null
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Cloudflare API error";
}
