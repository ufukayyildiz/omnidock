import {
  BootstrapPayload,
  BucketObjectsPayload,
  BucketSearchPayload,
  BucketTextIndexPayload,
  AuditLogsPayload,
  ContactRow,
  DomainRow,
  ExternalAccountRow,
  ExternalSyncJobRow,
  SetupStatusPayload,
  ThreadPayload,
  ThreadListPayload
} from "./types";

const SEND_REQUEST_TIMEOUT_MS = 70_000;
const BUCKET_SEARCH_TIMEOUT_MS = 35_000;

export type AttachmentDraft = {
  filename: string;
  contentType: string;
  contentBase64: string;
  size: number;
};

export type ContactInput = {
  email: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  tags?: string | null;
  notes?: string | null;
};

export type ContactImportReport = {
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  rows: {
    email: string;
    status: "created" | "updated" | "skipped";
    message?: string;
  }[];
};

export type ExternalAccountInput = {
  provider: string;
  email: string;
  displayName?: string | null;
  username?: string | null;
  authType: string;
  credentialSecretName?: string | null;
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecurity: string;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecurity: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  notes?: string | null;
};

export function setupStatus(): Promise<SetupStatusPayload> {
  return publicRequest<SetupStatusPayload>("/api/setup/status");
}

export function createAdmin(input: {
  name: string;
  email: string;
  recoveryEmail: string;
  primaryDomain: string;
  password?: string | null;
}): Promise<{ ok: true }> {
  return publicRequest("/api/setup", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function requestPasswordReset(email: string): Promise<{ ok: true }> {
  return publicRequest("/api/auth/reset/request", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export function confirmPasswordReset(input: { token: string; password: string }): Promise<{ ok: true }> {
  return publicRequest("/api/auth/reset/confirm", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function login(password: string): Promise<{ ok: true }> {
  return publicRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export function logout(): Promise<{ ok: true }> {
  return publicRequest("/api/auth/logout", { method: "POST" });
}

export class ApiClient {
  bootstrap(): Promise<BootstrapPayload> {
    return this.request<BootstrapPayload>("/api/bootstrap");
  }

  threads(
    folder: string,
    mailboxId: string | null,
    query: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ThreadListPayload> {
    const params = new URLSearchParams({ folder });
    if (mailboxId) params.set("mailboxId", mailboxId);
    if (query.trim()) params.set("q", query.trim());
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset) params.set("offset", String(options.offset));
    return this.request<ThreadListPayload>(`/api/threads?${params.toString()}`);
  }

  thread(threadId: string): Promise<ThreadPayload> {
    return this.request<ThreadPayload>(`/api/threads/${threadId}`);
  }

  addDomain(domain: string): Promise<{ ok: true; domain: DomainRow }> {
    return this.request("/api/domains", {
      method: "POST",
      body: JSON.stringify({ domain })
    });
  }

  setDefaultDomain(domainId: string): Promise<{ ok: true; domain: DomainRow }> {
    return this.request(`/api/domains/${domainId}/default`, { method: "POST" });
  }

  syncCloudflare(): Promise<unknown> {
    return this.request("/api/sync/cloudflare", { method: "POST" });
  }

  enableCatchAll(domainId: string): Promise<unknown> {
    return this.request(`/api/domains/${domainId}/catch-all`, { method: "POST" });
  }

  createMailbox(domainId: string, localPart: string, displayName: string | null, createRule: boolean): Promise<unknown> {
    return this.request("/api/mailboxes", {
      method: "POST",
      body: JSON.stringify({ domainId, localPart, displayName, createRule })
    });
  }

  enableMailboxRouting(mailboxId: string): Promise<unknown> {
    return this.request(`/api/mailboxes/${mailboxId}/routing-rule`, { method: "POST" });
  }

  saveSignature(mailboxId: string, input: { textSignature: string; htmlSignature?: string | null; enabled: boolean }): Promise<unknown> {
    return this.request(`/api/mailboxes/${mailboxId}/signature`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  }

  addContact(input: ContactInput): Promise<{ ok: true; contact: ContactRow }> {
    return this.request("/api/contacts", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  saveContact(input: ContactInput, id?: string | null): Promise<{ ok: true; contact: ContactRow }> {
    return this.request(id ? `/api/contacts/${id}` : "/api/contacts", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(input)
    });
  }

  deleteContact(id: string): Promise<unknown> {
    return this.request(`/api/contacts/${id}`, { method: "DELETE" });
  }

  importContacts(contacts: ContactInput[], source = "upload"): Promise<{ ok: true; report: ContactImportReport }> {
    return this.request("/api/contacts/import", {
      method: "POST",
      body: JSON.stringify({ contacts, source })
    });
  }

  saveExternalAccount(input: ExternalAccountInput, id?: string | null): Promise<{ ok: true; account: ExternalAccountRow }> {
    return this.request(id ? `/api/external-accounts/${id}` : "/api/external-accounts", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(input)
    });
  }

  syncExternalAccount(id: string): Promise<{
    ok: true;
    queued: number;
    job: ExternalSyncJobRow;
  }> {
    return this.request(`/api/external-accounts/${id}/sync`, { method: "POST" });
  }

  startExternalSync(): Promise<{ ok: true; queued: number; jobs: ExternalSyncJobRow[] }> {
    return this.request("/api/sync/external", { method: "POST" });
  }

  externalSyncJobs(): Promise<{ ok: true; jobs: ExternalSyncJobRow[] }> {
    return this.request("/api/sync/external");
  }

  resumeExternalSync(): Promise<{ ok: true; jobs: ExternalSyncJobRow[] }> {
    return this.request("/api/sync/external/run", { method: "POST" });
  }

  auditLogs(input: { query?: string; limit?: number } = {}): Promise<AuditLogsPayload> {
    const params = new URLSearchParams();
    if (input.query?.trim()) params.set("q", input.query.trim());
    if (input.limit) params.set("limit", String(input.limit));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return this.request<AuditLogsPayload>(`/api/audit-logs${suffix}`);
  }

  deleteAuditLog(id: string): Promise<{ ok: true; deleted: number }> {
    return this.request(`/api/audit-logs/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  deleteAuditLogs(ids: string[]): Promise<{ ok: true; deleted: number }> {
    return this.request("/api/audit-logs/delete", {
      method: "POST",
      body: JSON.stringify({ ids })
    });
  }

  clearAuditLogs(): Promise<{ ok: true; deleted: number }> {
    return this.request("/api/audit-logs/delete", {
      method: "POST",
      body: JSON.stringify({ all: true })
    });
  }

  deleteExternalAccount(id: string): Promise<unknown> {
    return this.request(`/api/external-accounts/${id}`, { method: "DELETE" });
  }

  patchThread(threadId: string, action: "read" | "archive" | "unarchive"): Promise<unknown> {
    return this.request(`/api/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ action })
    });
  }

  deleteThread(threadId: string): Promise<unknown> {
    return this.request(`/api/threads/${threadId}`, { method: "DELETE" });
  }

  send(input: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string | null;
    replyToThreadId?: string;
    attachments?: AttachmentDraft[];
  }): Promise<unknown> {
    const path = input.replyToThreadId ? `/api/threads/${input.replyToThreadId}/reply` : "/api/send";
    return this.requestWithTimeout(
      path,
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      SEND_REQUEST_TIMEOUT_MS,
      "Sending timed out. Check the Gmail app password secret and SMTP settings, then try again."
    );
  }

  changePassword(password: string): Promise<unknown> {
    return this.request("/api/auth/password", {
      method: "PUT",
      body: JSON.stringify({ password })
    });
  }

  async downloadAttachment(id: string): Promise<Blob> {
    const response = await fetch(`/api/attachments/${id}`, {
      credentials: "same-origin"
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new ApiRequestError(response.status, payload?.error?.message ?? `Download failed with ${response.status}`);
    }
    return response.blob();
  }

  listBucketObjects(bucketId: string, prefix: string, cursor?: string | null): Promise<BucketObjectsPayload> {
    const params = new URLSearchParams();
    if (prefix) params.set("prefix", prefix);
    if (cursor) params.set("cursor", cursor);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return this.request<BucketObjectsPayload>(`/api/buckets/${encodeURIComponent(bucketId)}/objects${suffix}`);
  }

  searchBucketObjects(input: {
    bucketId: string | null;
    query: string;
    allBuckets: boolean;
    includeText: boolean;
  }): Promise<BucketSearchPayload> {
    const params = new URLSearchParams({ q: input.query });
    params.set("scope", input.allBuckets ? "all" : "bucket");
    if (input.bucketId) params.set("bucketId", input.bucketId);
    if (input.includeText) params.set("text", "1");
    return this.requestWithTimeout<BucketSearchPayload>(
      `/api/buckets/search?${params.toString()}`,
      {},
      BUCKET_SEARCH_TIMEOUT_MS,
      "Bucket search timed out. Narrow the scope or turn off Text/PDF search, then try again."
    );
  }

  async downloadBucketObject(bucketId: string, key: string): Promise<Blob> {
    const response = await fetch(`/api/buckets/${encodeURIComponent(bucketId)}/object?key=${encodeURIComponent(key)}`, {
      credentials: "same-origin"
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new ApiRequestError(response.status, payload?.error?.message ?? `Download failed with ${response.status}`);
    }
    return response.blob();
  }

  async uploadBucketObject(bucketId: string, key: string, file: File): Promise<unknown> {
    const response = await fetch(`/api/buckets/${encodeURIComponent(bucketId)}/object?key=${encodeURIComponent(key)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "content-type": file.type || "application/octet-stream"
      },
      body: file
    });
    return readApiResponse(response);
  }

  async deleteBucketObject(bucketId: string, key: string): Promise<unknown> {
    const response = await fetch(`/api/buckets/${encodeURIComponent(bucketId)}/object?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
      credentials: "same-origin"
    });
    return readApiResponse(response);
  }

  getBucketObjectTextIndex(bucketId: string, key: string): Promise<BucketTextIndexPayload> {
    return this.request<BucketTextIndexPayload>(`/api/buckets/${encodeURIComponent(bucketId)}/object-text?key=${encodeURIComponent(key)}`);
  }

  saveBucketObjectTextIndex(bucketId: string, key: string, text: string, source = "manual"): Promise<BucketTextIndexPayload> {
    return this.request<BucketTextIndexPayload>(`/api/buckets/${encodeURIComponent(bucketId)}/object-text?key=${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ text, source })
    });
  }

  deleteBucketObjectTextIndex(bucketId: string, key: string): Promise<unknown> {
    return this.request(`/api/buckets/${encodeURIComponent(bucketId)}/object-text?key=${encodeURIComponent(key)}`, {
      method: "DELETE"
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: { message?: string } }
      | null;

    if (!response.ok || payload?.ok === false) {
      throw new ApiRequestError(response.status, payload?.error?.message ?? `Request failed with ${response.status}`);
    }

    return payload as T;
  }

  private async requestWithTimeout<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.request<T>(path, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new ApiRequestError(504, timeoutMessage);
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
}

async function readApiResponse<T = unknown>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: { message?: string } }
    | null;

  if (!response.ok || payload?.ok === false) {
    throw new ApiRequestError(response.status, payload?.error?.message ?? `Request failed with ${response.status}`);
  }

  return payload as T;
}

async function publicRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: { message?: string } }
    | null;

  if (!response.ok || payload?.ok === false) {
    throw new ApiRequestError(response.status, payload?.error?.message ?? `Request failed with ${response.status}`);
  }

  return payload as T;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
