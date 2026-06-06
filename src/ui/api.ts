import { BootstrapPayload, ContactRow, DomainRow, SetupStatusPayload, ThreadPayload, ThreadRow } from "./types";

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
  tags?: string | null;
  notes?: string | null;
};

export function setupStatus(): Promise<SetupStatusPayload> {
  return publicRequest<SetupStatusPayload>("/api/setup/status");
}

export function createAdmin(input: { name: string; email: string; password: string }): Promise<{ ok: true }> {
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

export class ApiClient {
  constructor(private readonly password: string) {}

  bootstrap(): Promise<BootstrapPayload> {
    return this.request<BootstrapPayload>("/api/bootstrap");
  }

  threads(
    folder: string,
    mailboxId: string | null,
    query: string
  ): Promise<{ ok: true; threads: ThreadRow[]; stats: Record<string, number> }> {
    const params = new URLSearchParams({ folder });
    if (mailboxId) params.set("mailboxId", mailboxId);
    if (query.trim()) params.set("q", query.trim());
    return this.request<{ ok: true; threads: ThreadRow[]; stats: Record<string, number> }>(`/api/threads?${params.toString()}`);
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

  importContacts(contacts: ContactInput[], source = "upload"): Promise<{ ok: true; imported: number }> {
    return this.request("/api/contacts/import", {
      method: "POST",
      body: JSON.stringify({ contacts, source })
    });
  }

  patchThread(threadId: string, action: "read" | "archive" | "unarchive"): Promise<unknown> {
    return this.request(`/api/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ action })
    });
  }

  send(input: {
    from: string;
    to: string;
    subject: string;
    text: string;
    replyToThreadId?: string;
    attachments?: AttachmentDraft[];
  }): Promise<unknown> {
    const path = input.replyToThreadId ? `/api/threads/${input.replyToThreadId}/reply` : "/api/send";
    return this.request(path, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  changePassword(password: string): Promise<unknown> {
    return this.request("/api/auth/password", {
      method: "PUT",
      body: JSON.stringify({ password })
    });
  }

  async downloadAttachment(id: string): Promise<Blob> {
    const response = await fetch(`/api/attachments/${id}`, {
      headers: {
        authorization: `Bearer ${this.password}`
      }
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message ?? `Download failed with ${response.status}`);
    }
    return response.blob();
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: {
        authorization: `Bearer ${this.password}`,
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: { message?: string } }
      | null;

    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message ?? `Request failed with ${response.status}`);
    }

    return payload as T;
  }
}

async function publicRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: { message?: string } }
    | null;

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message ?? `Request failed with ${response.status}`);
  }

  return payload as T;
}
