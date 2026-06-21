import {
  AlertTriangle,
  Archive,
  Bold,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  Eye,
  FileText,
  FileUp,
  FolderGit2,
  FolderPlus,
  Inbox,
  Italic,
  Loader2,
  Link,
  Mail,
  PaintBucket,
  Paperclip,
  PenLine,
  Phone,
  Plus,
  RefreshCw,
  Reply,
  Save,
  Search,
  Send,
  SendHorizontal,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  TerminalSquare,
  Trash2,
  Type,
  Underline,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { createContext, FormEvent, MouseEvent as ReactMouseEvent, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiClient,
  ApiRequestError,
  AttachmentDraft,
  ContactInput,
  ExternalAccountInput,
  confirmPasswordReset,
  createAdmin,
  login,
  logout,
  requestPasswordReset,
  setupStatus
} from "./api";
import {
  AuditLogRow,
  AttachmentRow,
  BootstrapPayload,
  BucketIndexPayload,
  BucketIndexJobRow,
  BucketFolderRow,
  BucketObjectRow,
  BucketRow,
  BucketSearchResultRow,
  ContactRow,
  DomainRow,
  ExternalAccountRow,
  ExternalSyncJobRow,
  FolderKey,
  MailboxRow,
  MailboxSignatureRow,
  RuntimeRequirement,
  SetupStatusPayload,
  ThreadPayload,
  ThreadRow
} from "./types";

const DEFAULT_MAILBOX_KEY = "omnidock.defaultMailbox";
const REFRESH_INTERVAL_KEY = "omnidock.refreshIntervalSeconds";
const DEFAULT_REFRESH_INTERVAL_SECONDS = 10;
const NOTICE_AUTO_DISMISS_MS = 3000;
const EXTERNAL_MAILBOX_SCOPE_PREFIX = "external:";
const THREAD_PAGE_SIZE = 80;
const EXTERNAL_SYNC_POLL_INTERVAL_MS = 2500;
const EXTERNAL_SYNC_UI_MAX_WAIT_MS = 15 * 60 * 1000;
const EXTERNAL_SYNC_UI_STALE_MS = 70_000;

const folders: { key: FolderKey; label: string; icon: typeof Inbox }[] = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "sent", label: "Sent", icon: Send },
  { key: "archive", label: "Archive", icon: Archive }
];

type ViewKey = "mail" | "buckets" | "rules" | "contacts" | "signatures" | "external" | "logs" | "index-engine" | "notes" | "other-settings";
type SettingsViewKey = Exclude<ViewKey, "mail" | "buckets">;
type AuthViewKey = "checking" | "configuration" | "login" | "setup" | "reset-request" | "reset-confirm";
type RichEditorValue = { html: string; text: string };
type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};
type AppDialogTone = "default" | "danger";
type AppConfirmOptions = {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: AppDialogTone;
};
type AppPromptOptions = AppConfirmOptions & {
  defaultValue?: string;
  placeholder?: string;
  multiline?: boolean;
};
type AppDialogApi = {
  confirm: (options: AppConfirmOptions) => Promise<boolean>;
  prompt: (options: AppPromptOptions) => Promise<string | null>;
};
type ActiveDialog =
  | ({ kind: "confirm" } & AppConfirmOptions)
  | ({ kind: "prompt" } & AppPromptOptions);
type ContactParseResult = {
  contacts: ContactInput[];
  scanned: number;
  duplicateEmails: number;
  ignoredRows: number;
};
type BucketUploadEntry = {
  id: string;
  name: string;
  key: string;
  size: number;
  status: "queued" | "uploading" | "done" | "error";
  message?: string;
};
type BucketUploadState = {
  active: boolean;
  total: number;
  completed: number;
  entries: BucketUploadEntry[];
};
type BucketSearchScope = "current" | "all";
type BucketDisplayObjectRow = BucketObjectRow & Partial<Pick<BucketSearchResultRow, "bucketId" | "bucketName" | "bucketBinding" | "match" | "snippet">>;

const AppDialogContext = createContext<AppDialogApi | null>(null);
type NoticeState = { id: number; message: string };

const MAX_CLIENT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_CLIENT_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_BUCKET_INLINE_PREVIEW_BYTES = 10 * 1024 * 1024;

const externalProviderPresets: Record<
  string,
  {
    label: string;
    imapHost: string;
    imapPort: number;
    imapSecurity: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecurity: string;
  }
> = {
  gmail: {
    label: "Gmail",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecurity: "ssl",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecurity: "ssl"
  },
  outlook: {
    label: "Outlook",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecurity: "ssl",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecurity: "starttls"
  },
  yahoo: {
    label: "Yahoo",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    imapSecurity: "ssl",
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 587,
    smtpSecurity: "starttls"
  },
  icloud: {
    label: "iCloud",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapSecurity: "ssl",
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecurity: "starttls"
  },
  custom: {
    label: "Custom",
    imapHost: "",
    imapPort: 993,
    imapSecurity: "ssl",
    smtpHost: "",
    smtpPort: 587,
    smtpSecurity: "starttls"
  }
};

const securityOptions: SelectOption[] = [
  { value: "ssl", label: "SSL" },
  { value: "starttls", label: "STARTTLS" },
  { value: "none", label: "None" }
];

function initialRefreshIntervalSeconds(): number {
  const stored = Number(localStorage.getItem(REFRESH_INTERVAL_KEY));
  return Number.isFinite(stored) && stored >= 0 ? stored : DEFAULT_REFRESH_INTERVAL_SECONDS;
}

export function App() {
  return (
    <AppDialogProvider>
      <AppContent />
    </AppDialogProvider>
  );
}

function AppDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const resolverRef = useRef<((value: boolean | string | null) => void) | null>(null);

  const closeDialog = useCallback((value: boolean | string | null) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    if (resolver) resolver(value);
  }, []);

  const confirm = useCallback((options: AppConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = (value) => resolve(value === true);
      setDialog({ kind: "confirm", ...options });
    });
  }, []);

  const prompt = useCallback((options: AppPromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setPromptValue(options.defaultValue ?? "");
      resolverRef.current = (value) => resolve(typeof value === "string" ? value : null);
      setDialog({ kind: "prompt", ...options });
    });
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const activeDialog = dialog;

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDialog(activeDialog.kind === "prompt" ? null : false);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [closeDialog, dialog]);

  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);
  const confirmLabel = dialog?.confirmLabel ?? (dialog?.kind === "prompt" ? "Apply" : "OK");
  const cancelLabel = dialog?.cancelLabel ?? "Cancel";
  const isDanger = dialog?.tone === "danger";

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      {dialog ? (
        <div className="modal-scrim app-dialog-scrim" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
          <form
            className={isDanger ? "app-dialog danger" : "app-dialog"}
            onSubmit={(event) => {
              event.preventDefault();
              closeDialog(dialog.kind === "prompt" ? promptValue : true);
            }}
          >
            <header>
              <span className="app-dialog-icon">{isDanger ? <AlertTriangle size={17} /> : <ShieldCheck size={17} />}</span>
              <div>
                <strong id="app-dialog-title">{dialog.title}</strong>
                <div className="app-dialog-message">{dialog.message}</div>
              </div>
            </header>
            {dialog.kind === "prompt" ? (
              dialog.multiline ? (
                <textarea
                  className="text-input app-dialog-textarea"
                  value={promptValue}
                  onChange={(event) => setPromptValue(event.target.value)}
                  placeholder={dialog.placeholder}
                  autoFocus
                />
              ) : (
                <input
                  className="text-input"
                  value={promptValue}
                  onChange={(event) => setPromptValue(event.target.value)}
                  placeholder={dialog.placeholder}
                  autoFocus
                />
              )
            ) : null}
            <div className="app-dialog-actions">
              <button className="button ghost" type="button" onClick={() => closeDialog(dialog.kind === "prompt" ? null : false)}>
                {cancelLabel}
              </button>
              <button className={isDanger ? "button danger" : "button primary"} type="submit">
                {confirmLabel}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AppDialogContext.Provider>
  );
}

function useAppDialog(): AppDialogApi {
  const dialog = useContext(AppDialogContext);
  if (!dialog) {
    throw new Error("App dialog context is not available");
  }
  return dialog;
}

function AppContent() {
  const initialResetToken = useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);
  const [authenticated, setAuthenticated] = useState(false);
  const [draftPassword, setDraftPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authView, setAuthView] = useState<AuthViewKey>(initialResetToken ? "reset-confirm" : "checking");
  const [resetToken, setResetToken] = useState(initialResetToken);
  const [setup, setSetup] = useState<SetupStatusPayload | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [folder, setFolder] = useState<FolderKey>("inbox");
  const [view, setView] = useState<ViewKey>("mail");
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null);
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null);
  const [defaultMailboxId, setDefaultMailboxId] = useState(() => localStorage.getItem(DEFAULT_MAILBOX_KEY) ?? "");
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(initialRefreshIntervalSeconds);
  const [folderStats, setFolderStats] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadTotal, setThreadTotal] = useState(0);
  const [threadHasMore, setThreadHasMore] = useState(false);
  const [threadLoadingMore, setThreadLoadingMore] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadPayload | null>(null);
  const [notice, setNoticeState] = useState<NoticeState | null>(null);
  const [syncLog, setSyncLog] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const externalSyncingIds = useRef<Set<string>>(new Set());
  const externalSyncMonitorRef = useRef(false);
  const sessionCheckRef = useRef(false);
  const noticeSeqRef = useRef(0);

  const api = useMemo(() => (authenticated ? new ApiClient() : null), [authenticated]);
  const setNotice = useCallback((message: string | null) => {
    setNoticeState(message ? { id: (noticeSeqRef.current += 1), message } : null);
  }, []);
  const selectedExternalAccount = useMemo(
    () => (bootstrap && selectedMailboxId ? externalAccountFromScope(selectedMailboxId, bootstrap.externalAccounts ?? []) : null),
    [bootstrap, selectedMailboxId]
  );

  useEffect(() => {
    if (!initialResetToken) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("token")) return;
    url.searchParams.delete("token");
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }, [initialResetToken]);

  const clearPrivateState = useCallback(() => {
    setBootstrap(null);
    setThreads([]);
    setThreadTotal(0);
    setThreadHasMore(false);
    setThreadLoadingMore(false);
    setActiveThreadId(null);
    setThread(null);
    setSelectedDomainId(null);
    setSelectedMailboxId(null);
    setSelectedBucketId(null);
    setFolderStats({});
    setSyncLog("Locked");
    setComposeOpen(false);
  }, []);

  const applyBootstrap = useCallback((data: BootstrapPayload) => {
    const mailboxScopes = [...data.mailboxes.map((mailbox) => mailbox.id), ...(data.externalAccounts ?? []).map(externalMailboxScopeId)];
    const hasMailboxScopes = mailboxScopes.length > 0;
    const defaultDomain = data.domains.find((domain) => domain.is_default === 1) ?? null;
    setBootstrap(data);
    setThreads(hasMailboxScopes ? [] : data.threads);
    setThreadTotal(hasMailboxScopes ? 0 : data.threads.length);
    setThreadHasMore(false);
    setFolderStats(data.stats);
    setSelectedDomainId((current) =>
      current && data.domains.some((domain) => domain.id === current) ? current : defaultDomain?.id ?? data.domains[0]?.id ?? null
    );
    setSelectedMailboxId((current) => {
      if (current && mailboxScopes.includes(current)) return current;

      const storedDefaultId = localStorage.getItem(DEFAULT_MAILBOX_KEY) ?? "";
      if (storedDefaultId && mailboxScopes.includes(storedDefaultId)) {
        setDefaultMailboxId(storedDefaultId);
        return storedDefaultId;
      }

      if (storedDefaultId) {
        localStorage.removeItem(DEFAULT_MAILBOX_KEY);
        setDefaultMailboxId("");
      }

      return mailboxScopes[0] ?? null;
    });
    setSelectedBucketId((current) =>
      current && data.buckets.some((bucket) => bucket.id === current) ? current : data.buckets[0]?.id ?? null
    );
    setActiveThreadId((current) => (hasMailboxScopes ? null : current ?? data.threads[0]?.thread_id ?? null));
    setLoginError(null);
    setNotice(null);
  }, []);

  const loadSetupStatus = useCallback(async (options: { fallbackToChecking?: boolean } = {}) => {
    try {
      const status = await setupStatus();
      setSetup(status);
      setLoginError(null);
      if (!status.configurationReady) {
        setAuthView("configuration");
      } else if (status.setupRequired) {
        setAuthView("setup");
      } else if (resetToken) {
        setAuthView("reset-confirm");
      } else {
        if (!sessionCheckRef.current) {
          sessionCheckRef.current = true;
          try {
            const data = await new ApiClient().bootstrap();
            applyBootstrap(data);
            setAuthenticated(true);
            return;
          } catch (error) {
            if (!isAuthError(error)) {
              setLoginError(readError(error));
            }
          }
        }
        setAuthView("login");
      }
    } catch (error) {
      setLoginError(readError(error));
      if (options.fallbackToChecking !== false) {
        setSetup(null);
        setAuthView("checking");
      }
    }
  }, [applyBootstrap, resetToken]);

  const loadBootstrap = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      const data = await api.bootstrap();
      applyBootstrap(data);
    } catch (error) {
      const message = readError(error);
      if (isAuthError(error)) {
        setAuthenticated(false);
        setAuthView("login");
        setLoginError(message);
        setNotice(null);
        clearPrivateState();
      } else {
        setNotice(message);
        setLoginError(null);
      }
    } finally {
      setBusy(false);
    }
  }, [api, applyBootstrap, clearPrivateState]);

  useEffect(() => {
    if (!authenticated) {
      void loadSetupStatus();
    }
  }, [authenticated, loadSetupStatus]);

  const loadThreads = useCallback(async (options: { preserveSelection?: boolean; clearSelection?: boolean; append?: boolean; offset?: number } = {}) => {
    if (!api) return;
    const append = Boolean(options.append);
    if (append) setThreadLoadingMore(true);
    try {
      const data = await api.threads(folder, selectedMailboxId, query, {
        limit: THREAD_PAGE_SIZE,
        offset: options.offset ?? 0
      });
      setThreads((current) => {
        if (!append) return data.threads;
        const seen = new Set(current.map((item) => item.thread_id));
        return [...current, ...data.threads.filter((item) => !seen.has(item.thread_id))];
      });
      setThreadTotal(data.total);
      setThreadHasMore(data.hasMore);
      setFolderStats(data.stats);
      setActiveThreadId((current) => {
        if (append) {
          return current;
        }
        if (options.clearSelection) {
          return null;
        }
        if (options.preserveSelection && current && data.threads.some((item) => item.thread_id === current)) {
          return current;
        }
        return data.threads[0]?.thread_id ?? null;
      });
    } catch (error) {
      setNotice(readError(error));
    } finally {
      if (append) setThreadLoadingMore(false);
    }
  }, [api, folder, query, selectedMailboxId]);

  const loadThread = useCallback(
    async (threadId: string) => {
      if (!api) return;
      try {
        const data = await api.thread(threadId);
        setThread(data);
        await api.patchThread(threadId, "read");
      } catch (error) {
        setNotice(readError(error));
      }
    },
    [api]
  );

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (api && bootstrap && view === "mail") {
      void loadThreads();
    }
  }, [api, bootstrap, folder, selectedMailboxId, view]);

  useEffect(() => {
    if (!api || !bootstrap || externalSyncMonitorRef.current) return;
    const inboundAccounts = (bootstrap.externalAccounts ?? []).filter((account) => account.inbound_enabled === 1);
    if (inboundAccounts.length === 0) return;

    let cancelled = false;
    void api.externalSyncJobs()
      .then(async (payload) => {
        if (cancelled || externalSyncMonitorRef.current) return;
        const inboundIds = new Set(inboundAccounts.map((account) => account.id));
        const activeJobs = payload.jobs.filter((job) => inboundIds.has(job.account_id) && isActiveExternalSyncJob(job));
        if (activeJobs.length === 0) return;

        externalSyncMonitorRef.current = true;
        setSyncLog(`Resuming ${activeJobs.length} external inbox pull${activeJobs.length === 1 ? "" : "s"}...`);
        await api.resumeExternalSync();
        const result = await pollExternalSyncJobs(api, inboundAccounts, setSyncLog);
        if (cancelled) return;
        await loadBootstrap();
        await loadThreads({ preserveSelection: true });
        const moreText = result.timedOut ? " More mail remains; run Sync again to continue from the saved cursor." : "";
        setSyncLog(`External sync ${result.timedOut ? "paused" : "complete"}: ${formatExternalSyncSummary(result)}`);
        setNotice(`External mail synced: ${formatExternalSyncSummary(result)}.${moreText}`);
      })
      .catch((error) => {
        if (!cancelled) setSyncLog(`External sync status failed: ${readError(error)}`);
      })
      .finally(() => {
        externalSyncMonitorRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [api, bootstrap, loadBootstrap, loadThreads]);

  useEffect(() => {
    if (!api || !bootstrap || view !== "mail" || !selectedExternalAccount) return;
    if (selectedExternalAccount.inbound_enabled !== 1 || selectedExternalAccount.last_checked_at) return;
    if (externalSyncingIds.current.has(selectedExternalAccount.id)) return;

    externalSyncingIds.current.add(selectedExternalAccount.id);
    setSyncLog(`Queueing ${selectedExternalAccount.email} old mail pull...`);
    setNotice(`Old mail pull queued for ${selectedExternalAccount.email}.`);
    void api.syncExternalAccount(selectedExternalAccount.id)
      .then(async () => {
        const result = await pollExternalSyncJobs(api, [selectedExternalAccount], setSyncLog);
        await loadBootstrap();
        await loadThreads({ preserveSelection: true });
        const moreText = result.timedOut ? " More mail remains; run Sync again to continue from the saved cursor." : "";
        setSyncLog(`${selectedExternalAccount.email}: ${formatExternalSyncSummary(result)}`);
        setNotice(`External mail synced: ${formatExternalSyncSummary(result)}.${moreText}`);
      })
      .catch((error) => {
        const message = readError(error);
        setSyncLog(`${selectedExternalAccount.email}: ${message}`);
        setNotice(message);
      })
      .finally(() => {
        externalSyncingIds.current.delete(selectedExternalAccount.id);
      });
  }, [api, bootstrap, loadBootstrap, loadThreads, selectedExternalAccount, view]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (api && bootstrap && view === "mail") {
        void loadThreads();
      }
    }, 240);
    return () => window.clearTimeout(timeout);
  }, [api, bootstrap, query, selectedMailboxId, view, loadThreads]);

  useEffect(() => {
    localStorage.setItem(REFRESH_INTERVAL_KEY, String(refreshIntervalSeconds));
  }, [refreshIntervalSeconds]);

  useEffect(() => {
    if (!api || !bootstrap || view !== "mail" || refreshIntervalSeconds <= 0) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadThreads({ preserveSelection: true });
    }, refreshIntervalSeconds * 1000);

    return () => window.clearInterval(interval);
  }, [api, bootstrap, loadThreads, refreshIntervalSeconds, view]);

  useEffect(() => {
    if (busy || syncLog === "Ready" || syncLog === "Locked") return;
    const timer = window.setTimeout(() => {
      setSyncLog("Ready");
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [busy, syncLog]);

  useEffect(() => {
    if (!notice) return;
    const noticeId = notice.id;
    const timer = window.setTimeout(() => {
      setNoticeState((current) => (current?.id === noticeId ? null : current));
    }, NOTICE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (activeThreadId) {
      void loadThread(activeThreadId);
    } else {
      setThread(null);
    }
  }, [activeThreadId, loadThread]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftPassword) return;
    setBusy(true);
    setLoginError(null);
    setAuthNotice(null);
    clearPrivateState();
    try {
      await login(draftPassword);
      setDraftPassword("");
      setAuthenticated(true);
    } catch (error) {
      setLoginError(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitSetup(input: {
    name: string;
    email: string;
    recoveryEmail: string;
    primaryDomain: string;
    password?: string | null;
  }) {
    setBusy(true);
    try {
      await createAdmin(input);
      setAuthenticated(false);
      sessionCheckRef.current = true;
      setDraftPassword("");
      setAuthNotice("Setup complete. Log in with your password.");
      setLoginError(null);
      await loadSetupStatus();
      setAuthView("login");
    } catch (error) {
      setLoginError(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitResetRequest(email: string) {
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setAuthNotice("If the email matches the admin account, a reset link has been sent.");
      setLoginError(null);
      setAuthView("login");
    } catch (error) {
      setLoginError(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitResetConfirm(input: { password: string }) {
    if (!resetToken) return;
    setBusy(true);
    try {
      await confirmPasswordReset({ token: resetToken, password: input.password });
      window.history.replaceState(null, "", window.location.pathname);
      setResetToken("");
      setDraftPassword("");
      setAuthNotice("Password updated. Log in with the new password.");
      setLoginError(null);
      setAuthView("login");
      await loadSetupStatus();
    } catch (error) {
      setLoginError(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function retrySetupStatus() {
    setBusy(true);
    setLoginError(null);
    try {
      await loadSetupStatus({ fallbackToChecking: false });
    } finally {
      setBusy(false);
    }
  }

  function lock() {
    void logout().catch(() => undefined);
    sessionCheckRef.current = true;
    setAuthenticated(false);
    setLoginError(null);
    setAuthNotice(null);
    clearPrivateState();
    setAuthView(setup && !setup.configurationReady ? "configuration" : setup?.setupRequired ? "setup" : "login");
  }

  if (!authenticated) {
    if (authView === "checking") {
      return <AuthStatusScreen busy={busy} error={loginError} onRetry={retrySetupStatus} />;
    }

    if (authView === "setup") {
      return (
        <SetupScreen
          busy={busy}
          error={loginError}
          defaultDomain={setup?.primaryDomain ?? ""}
          passwordFromSecret={Boolean(setup?.passwordFromSecret)}
          onSubmit={submitSetup}
        />
      );
    }

    if (authView === "configuration") {
      return (
        <ConfigurationScreen
          busy={busy}
          error={loginError}
          requirements={setup?.requirements ?? []}
          onRetry={retrySetupStatus}
        />
      );
    }

    if (authView === "reset-request") {
      return (
        <ResetRequestScreen
          busy={busy}
          error={loginError}
          onBack={() => {
            setLoginError(null);
            setAuthView("login");
          }}
          onSubmit={submitResetRequest}
        />
      );
    }

    if (authView === "reset-confirm") {
      return (
        <ResetConfirmScreen
          busy={busy}
          error={loginError}
          onSubmit={submitResetConfirm}
        />
      );
    }

    return (
      <LoginScreen
        draftPassword={draftPassword}
        setDraftPassword={setDraftPassword}
        error={loginError}
        notice={authNotice}
        onSubmit={unlock}
        resetAvailable={Boolean(setup?.resetAvailable)}
        onForgot={() => {
          setLoginError(null);
          setAuthNotice(null);
          setAuthView("reset-request");
        }}
      />
    );
  }

  if (!bootstrap) {
    return <AuthGate error={notice?.message ?? null} onLock={lock} />;
  }

  const domains = bootstrap.domains;
  const mailboxes = bootstrap.mailboxes;
  const contacts = bootstrap.contacts;
  const signatures = bootstrap.signatures;
  const externalAccounts = bootstrap.externalAccounts ?? [];
  const buckets = bootstrap.buckets ?? [];
  const activeDomain = domains.find((domain) => domain.id === selectedDomainId) ?? null;
  const activeMailbox = mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? null;
  const activeExternalAccount = externalAccountFromScope(selectedMailboxId, externalAccounts);
  const activeMailboxLabel = activeMailbox?.address ?? activeExternalAccount?.email ?? null;
  const mailboxScopeOptions = combinedMailboxOptions(mailboxes, externalAccounts);
  const activeBucket = buckets.find((bucket) => bucket.id === selectedBucketId) ?? buckets[0] ?? null;
  const changeMailboxScope = (mailboxId: string | null) => {
    setSelectedMailboxId(mailboxId);
    setThreads([]);
    setThreadTotal(0);
    setThreadHasMore(false);
    setActiveThreadId(null);
    setThread(null);
  };
  const defaultMailbox = mailboxes.find((mailbox) => mailbox.id === defaultMailboxId) ?? null;
  const defaultExternalAccount = externalAccountFromScope(defaultMailboxId, externalAccounts);
  const setDefaultMailboxPreference = () => {
    if (!selectedMailboxId || !activeMailboxLabel) {
      localStorage.removeItem(DEFAULT_MAILBOX_KEY);
      setDefaultMailboxId("");
      setNotice("Default mailbox cleared");
      return;
    }

    localStorage.setItem(DEFAULT_MAILBOX_KEY, selectedMailboxId);
    setDefaultMailboxId(selectedMailboxId);
    setNotice(`Default mailbox set to ${activeMailboxLabel}`);
  };
  const changeRefreshIntervalSeconds = (value: number) => {
    const nextValue = Number.isFinite(value) ? Math.round(value) : DEFAULT_REFRESH_INTERVAL_SECONDS;
    setRefreshIntervalSeconds(Math.min(300, Math.max(0, nextValue)));
  };

  async function handleThreadAction(action: "archive" | "unarchive" | "delete") {
    if (action === "delete") {
      setActiveThreadId(null);
      setThread(null);
      await loadThreads({ clearSelection: true });
    } else {
      await loadThreads({ preserveSelection: true });
    }
    setNotice(action === "archive" ? "Thread archived" : action === "delete" ? "Thread deleted" : "Thread restored");
  }

  async function syncEverything() {
    if (!api) return;

    setBusy(true);
    setNotice(null);
    const errors: string[] = [];

    try {
      setSyncLog("Sync started...");

      try {
        setSyncLog("Cloudflare inventory syncing...");
        await api.syncCloudflare();
        setSyncLog("Cloudflare inventory updated");
      } catch (error) {
        const message = readError(error);
        errors.push(`Cloudflare: ${message}`);
        setSyncLog(`Cloudflare skipped: ${message}`);
      }

      const latest = await api.bootstrap();
      setBootstrap(latest);
      const inboundAccounts = (latest.externalAccounts ?? []).filter((account) => account.inbound_enabled === 1);

      if (inboundAccounts.length === 0) {
        setSyncLog("No external inboxes to pull");
      } else {
        setSyncLog(`Queueing ${inboundAccounts.length} external inbox${inboundAccounts.length === 1 ? "" : "es"}...`);
        const queued = await api.startExternalSync();
        setSyncLog(`Queued ${queued.queued} external inbox${queued.queued === 1 ? "" : "es"}. Pulling in background...`);
        const result = await pollExternalSyncJobs(api, inboundAccounts, setSyncLog);
        if (result.timedOut) {
          errors.push("External mail is still pulling. Sync again continues from the saved cursor.");
        }
        if (result.failed > 0) {
          errors.push(`${result.failed} external inbox pull failed.`);
        }
      }

      const refreshed = await api.bootstrap();
      setBootstrap(refreshed);
      setFolderStats(refreshed.stats);
      await loadThreads({ preserveSelection: true });

      const finalJobs = await api.externalSyncJobs().catch(() => ({ ok: true as const, jobs: [] }));
      const inboundAccountIds = new Set(inboundAccounts.map((account) => account.id));
      const totals = summarizeExternalSyncJobs(finalJobs.jobs.filter((job) => inboundAccountIds.has(job.account_id)));
      if (errors.length > 0) {
        setNotice(`Sync finished with ${errors.length} warning${errors.length === 1 ? "" : "s"}: ${errors.join(" | ")}`);
        setSyncLog(`Sync finished: ${formatExternalSyncSummary(totals)}, ${errors.length} warning${errors.length === 1 ? "" : "s"}`);
      } else {
        setNotice(`Sync complete: ${formatExternalSyncSummary(totals)}`);
        setSyncLog(`Sync complete: ${formatExternalSyncSummary(totals)}`);
      }
    } catch (error) {
      const message = readError(error);
      setNotice(`Sync failed: ${message}`);
      setSyncLog(`Sync failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        managementHost={bootstrap?.managementHost ?? window.location.host}
        mailboxes={mailboxes}
        externalAccounts={externalAccounts}
        buckets={buckets}
        stats={folderStats}
        folder={folder}
        view={view}
        selectedMailboxId={selectedMailboxId}
        selectedBucketId={selectedBucketId}
        refreshIntervalSeconds={refreshIntervalSeconds}
        onMailboxChange={changeMailboxScope}
        onBucketOpen={(bucketId) => {
          setSelectedBucketId(bucketId);
          setView("buckets");
        }}
        onFolderChange={(nextFolder) => {
          setFolder(nextFolder);
          setView("mail");
          setThreads([]);
          setThreadTotal(0);
          setThreadHasMore(false);
          setActiveThreadId(null);
          setThread(null);
        }}
        onSettingsOpen={setView}
        onLock={lock}
      />

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-brand" aria-label="OmniDock control console">
            <img src="/omnidock-mark.svg" alt="" />
            <div>
              <strong>OmniDock</strong>
              <span>control plane</span>
            </div>
          </div>
          {view === "mail" ? (
            <div className="mail-search">
              <div className="search-wrap">
                <Search size={18} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subject, body, sender, recipient" />
              </div>
              <div className="search-scope" aria-label="Mailbox scope">
                <CustomSelect
                  value={selectedMailboxId ?? ""}
                  onChange={(value) => changeMailboxScope(value || null)}
                  disabled={mailboxScopeOptions.length === 0}
                  title="Mailbox scope"
                  options={[{ value: "", label: "All mailboxes" }, ...mailboxScopeOptions]}
                />
                <button
                  className={
                    selectedMailboxId && (defaultMailbox?.id === selectedMailboxId || externalMailboxScopeId(defaultExternalAccount) === selectedMailboxId)
                      ? "icon-button default-active"
                      : "icon-button"
                  }
                  type="button"
                  onClick={setDefaultMailboxPreference}
                  disabled={mailboxScopeOptions.length === 0}
                  title={
                    activeMailboxLabel
                      ? defaultMailbox?.id === selectedMailboxId || externalMailboxScopeId(defaultExternalAccount) === selectedMailboxId
                        ? `${activeMailboxLabel} opens by default`
                        : `Open ${activeMailboxLabel} by default`
                      : "Use all mailboxes as the default view"
                  }
                  aria-label={
                    activeMailboxLabel
                      ? defaultMailbox?.id === selectedMailboxId || externalMailboxScopeId(defaultExternalAccount) === selectedMailboxId
                        ? `${activeMailboxLabel} is the default mailbox`
                        : `Set ${activeMailboxLabel} as default mailbox`
                      : "Clear default mailbox"
                  }
                >
                  <Star size={16} />
                </button>
              </div>
            </div>
          ) : view === "buckets" ? (
            <BucketTitle bucket={activeBucket} />
          ) : (
            <SettingsTitle view={view} activeDomain={activeDomain} domains={domains} />
          )}
          <div className="topbar-actions">
            <button className="button" type="button" onClick={() => void syncEverything()} disabled={busy} title="Sync Cloudflare and pull external mail">
              {busy ? <Loader2 className="spin-icon" size={16} /> : <ShieldCheck size={16} />}
              Sync
            </button>
            <button className="button primary" type="button" onClick={() => setComposeOpen(true)}>
              <Plus size={16} />
              Compose
            </button>
          </div>
        </header>

        {notice ? (
          <div className="notice">
            <AlertTriangle size={16} />
            <span>{notice.message}</span>
            <button className="icon-button" type="button" onClick={() => setNotice(null)} title="Dismiss">
              <X size={14} />
            </button>
          </div>
        ) : null}

        {view === "buckets" ? (
          <BucketsView
            api={api}
            buckets={buckets}
            activeBucketId={selectedBucketId}
            onBucketChange={setSelectedBucketId}
            onNotice={setNotice}
          />
        ) : view === "rules" ? (
          <RulesView
            api={api}
            domains={domains}
            mailboxes={mailboxes}
            activeDomain={activeDomain}
            onDomainChange={setSelectedDomainId}
            onChange={loadBootstrap}
            onNotice={setNotice}
          />
        ) : view === "contacts" ? (
          <ContactsView api={api} contacts={contacts} onChange={loadBootstrap} onNotice={setNotice} />
        ) : view === "signatures" ? (
          <SignaturesView
            api={api}
            mailboxes={mailboxes}
            signatures={signatures}
            onChange={loadBootstrap}
            onNotice={setNotice}
          />
        ) : view === "external" ? (
          <ExternalAccountsView
            api={api}
            accounts={externalAccounts}
            onChange={loadBootstrap}
            onNotice={setNotice}
          />
        ) : view === "logs" ? (
          <LogsView api={api} onNotice={setNotice} />
        ) : view === "index-engine" ? (
          <IndexEngineView api={api} buckets={buckets} onNotice={setNotice} />
        ) : view === "notes" ? (
          <NotesView
            api={api}
            buckets={buckets}
            activeBucketId={selectedBucketId}
            onBucketChange={setSelectedBucketId}
            onNotice={setNotice}
          />
        ) : view === "other-settings" ? (
          <OtherSettingsView
            refreshIntervalSeconds={refreshIntervalSeconds}
            onRefreshIntervalChange={changeRefreshIntervalSeconds}
          />
        ) : (
          <section className="main-grid">
            <ThreadList
              threads={threads}
              total={threadTotal}
              hasMore={threadHasMore}
              loadingMore={threadLoadingMore}
              activeThreadId={activeThreadId}
              folder={folder}
              activeMailboxLabel={activeMailboxLabel}
              onSelect={(threadId) => setActiveThreadId(threadId)}
              onLoadMore={() => void loadThreads({ append: true, preserveSelection: true, offset: threads.length })}
            />
            <ThreadDetail
              api={api}
              thread={thread}
              mailboxes={mailboxes}
              externalAccounts={externalAccounts}
              folder={folder}
              onSent={async () => {
                if (activeThreadId) await loadThread(activeThreadId);
                await loadThreads();
              }}
              onThreadAction={handleThreadAction}
            />
          </section>
        )}
      </main>

      <footer className="statusbar">
        <span className="statusbar-log">
          {busy ? <Loader2 className="spin-icon" size={13} /> : <TerminalSquare size={13} />}
          {syncLog}
        </span>
        <span>
          <TerminalSquare size={13} />
          omnidock
        </span>
        <span>{activeDomain?.domain ?? `${domains.length} domains`}</span>
        <span>{view === "buckets" ? activeBucket?.name ?? "Buckets" : activeMailboxLabel ?? "All mailboxes"}</span>
        <span>{mailboxScopeOptions.length} mailboxes</span>
      </footer>

      {composeOpen ? (
        <ComposeDialog
          api={api}
          mailboxes={mailboxes}
          externalAccounts={externalAccounts}
          contacts={contacts}
          onClose={() => setComposeOpen(false)}
          onSent={async () => {
            setComposeOpen(false);
            await loadThreads();
          }}
          initialFrom={activeMailbox?.address ?? activeExternalAccount?.email ?? null}
        />
      ) : null}
    </div>
  );
}

function LoginScreen({
  draftPassword,
  setDraftPassword,
  error,
  notice,
  onSubmit,
  resetAvailable,
  onForgot
}: {
  draftPassword: string;
  setDraftPassword: (value: string) => void;
  error: string | null;
  notice: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  resetAvailable: boolean;
  onForgot: () => void;
}) {
  return (
    <main className="login-shell">
      <form className="login-box" onSubmit={onSubmit}>
        <div className="brand-block">
          <img src="/omnidock-mark.svg" alt="" />
          <div>
            <h1>OmniDock</h1>
            <p>{window.location.host || "Cloudflare Workers"}</p>
          </div>
        </div>
        {error ? (
          <div className="login-error">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        ) : null}
        {notice ? (
          <div className="auth-check">
            <ShieldCheck size={15} />
            <span>{notice}</span>
          </div>
        ) : null}
        <label className="field-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="text-input"
          type="password"
          value={draftPassword}
          onChange={(event) => setDraftPassword(event.target.value)}
          autoFocus
        />
        <button className="button primary wide" type="submit">
          <TerminalSquare size={16} />
          Unlock
        </button>
        {resetAvailable ? (
          <button className="button subtle wide" type="button" onClick={onForgot}>
            Reset password
          </button>
        ) : null}
      </form>
    </main>
  );
}

function ConfigurationScreen({
  busy,
  error,
  requirements,
  onRetry
}: {
  busy: boolean;
  error: string | null;
  requirements: RuntimeRequirement[];
  onRetry: () => void;
}) {
  const [copiedName, setCopiedName] = useState<string | null>(null);

  async function copyRequirementName(name: string) {
    await navigator.clipboard.writeText(name);
    setCopiedName(name);
    window.setTimeout(() => setCopiedName((current) => (current === name ? null : current)), 1400);
  }

  return (
    <main className="login-shell">
      <section className="login-box configuration-box">
        <div className="brand-block">
          <img src="/omnidock-mark.svg" alt="" />
          <div>
            <h1>OmniDock</h1>
            <p>{window.location.host || "Cloudflare Workers"}</p>
          </div>
        </div>
        <div className="login-error">
          <AlertTriangle size={15} />
          <span>{error ?? "Complete Cloudflare setup before first login."}</span>
        </div>
        <div className="requirement-list" aria-label="Required Cloudflare configuration">
          {requirements.map((item) => (
            <div
              className={[
                "requirement-row",
                item.configured ? "is-configured" : item.required ? "is-required" : "is-optional"
              ].join(" ")}
              key={`${item.kind}:${item.name}`}
            >
              <span className="requirement-status" aria-label={item.configured ? "Configured" : "Missing"}>
                {item.configured ? <CheckCircle2 size={15} /> : <AlertTriangle size={14} />}
              </span>
              <div className="requirement-meta">
                <span className="requirement-kind">{requirementKindLabel(item.kind)}</span>
                <span className="requirement-priority">
                  {item.configured ? "added" : item.required ? "required" : "optional"}
                </span>
              </div>
              <button
                className="requirement-name"
                type="button"
                onClick={() => void copyRequirementName(item.name)}
                title={`Copy ${item.name}`}
              >
                <code>{item.name}</code>
              </button>
              <button
                className="icon-button requirement-copy"
                type="button"
                onClick={() => void copyRequirementName(item.name)}
                title={`Copy ${item.name}`}
                aria-label={`Copy ${item.name}`}
              >
                {copiedName === item.name ? <CheckCircle2 size={15} /> : <Copy size={15} />}
              </button>
              <p>{item.message}</p>
            </div>
          ))}
        </div>
        <button className="button ghost wide" type="button" onClick={onRetry} disabled={busy}>
          <RefreshCw size={16} />
          {busy ? "Checking setup" : "Retry setup check"}
        </button>
      </section>
    </main>
  );
}

function requirementKindLabel(kind: RuntimeRequirement["kind"]): string {
  return kind === "variable" ? "plain" : kind;
}

function SetupScreen({
  busy,
  defaultDomain,
  error,
  passwordFromSecret,
  onSubmit
}: {
  busy: boolean;
  defaultDomain: string;
  error: string | null;
  passwordFromSecret: boolean;
  onSubmit: (input: {
    name: string;
    email: string;
    recoveryEmail: string;
    primaryDomain: string;
    password?: string | null;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [primaryDomain, setPrimaryDomain] = useState(defaultDomain);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordFromSecret && !password.trim()) {
      setLocalError("Admin password is required");
      return;
    }
    if (!passwordFromSecret && password !== confirm) {
      setLocalError("Passwords do not match");
      return;
    }
    if (!primaryDomain.trim()) {
      setLocalError("Primary domain is required");
      return;
    }
    if (!recoveryEmail.trim()) {
      setLocalError("Recovery email is required");
      return;
    }
    if (!isExternalRecoveryEmail(recoveryEmail, primaryDomain)) {
      setLocalError("Recovery email must be outside the primary domain");
      return;
    }
    setLocalError(null);
    await onSubmit({
      name,
      email,
      recoveryEmail: recoveryEmail.trim(),
      primaryDomain,
      password
    });
  }

  return (
    <main className="login-shell">
      <form className="login-box" onSubmit={submit}>
        <div className="brand-block">
          <img src="/omnidock-mark.svg" alt="" />
          <div>
            <h1>OmniDock</h1>
            <p>{window.location.host || "Cloudflare Workers"}</p>
          </div>
        </div>
        {error || localError ? (
          <div className="login-error">
            <AlertTriangle size={15} />
            <span>{localError ?? error}</span>
          </div>
        ) : null}
        <label className="field-label" htmlFor="setup-name">
          Name
        </label>
        <input
          id="setup-name"
          className="text-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          required
        />
        <label className="field-label" htmlFor="setup-email">
          Email
        </label>
        <input
          id="setup-email"
          className="text-input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <label className="field-label" htmlFor="setup-recovery-email">
          Recovery email
        </label>
        <input
          id="setup-recovery-email"
          className="text-input"
          type="email"
          value={recoveryEmail}
          onChange={(event) => setRecoveryEmail(event.target.value)}
          placeholder="you@gmail.com"
          required
        />
        <label className="field-label" htmlFor="setup-primary-domain">
          Primary domain
        </label>
        <input
          id="setup-primary-domain"
          className="text-input"
          value={primaryDomain}
          onChange={(event) => setPrimaryDomain(event.target.value)}
          placeholder="example.com"
          required
        />
        {passwordFromSecret ? (
          <>
            <label className="field-label" htmlFor="setup-password">
              Admin password
            </label>
            <input
              id="setup-password"
              className="text-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
              required
            />
            <div className="auth-check">
              <ShieldCheck size={15} />
              <span>Enter the ADMIN_PASSWORD secret once to claim this install.</span>
            </div>
          </>
        ) : (
          <>
            <label className="field-label" htmlFor="setup-password">
              Password
            </label>
            <input
              id="setup-password"
              className="text-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
              required
            />
            <label className="field-label" htmlFor="setup-confirm">
              Confirm password
            </label>
            <input
              id="setup-confirm"
              className="text-input"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              minLength={12}
              required
            />
          </>
        )}
        <button className="button primary wide" type="submit" disabled={busy}>
          <ShieldCheck size={16} />
          Create admin
        </button>
      </form>
    </main>
  );
}

function isExternalRecoveryEmail(email: string, primaryDomain: string): boolean {
  const at = email.trim().lastIndexOf("@");
  const recoveryDomain = at > 0 ? email.trim().slice(at + 1).toLowerCase().replace(/\.$/, "") : "";
  const normalizedPrimary = primaryDomain.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  if (!recoveryDomain || !normalizedPrimary) return false;
  return (
    recoveryDomain !== normalizedPrimary &&
    !recoveryDomain.endsWith(`.${normalizedPrimary}`) &&
    !normalizedPrimary.endsWith(`.${recoveryDomain}`)
  );
}

function ResetRequestScreen({
  busy,
  error,
  onBack,
  onSubmit
}: {
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(email);
  }

  return (
    <main className="login-shell">
      <form className="login-box" onSubmit={submit}>
        <div className="brand-block">
          <img src="/omnidock-mark.svg" alt="" />
          <div>
            <h1>OmniDock</h1>
            <p>{window.location.host || "Cloudflare Workers"}</p>
          </div>
        </div>
        {error ? (
          <div className="login-error">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        ) : null}
        <label className="field-label" htmlFor="reset-email">
          Email
        </label>
        <input
          id="reset-email"
          className="text-input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoFocus
          required
        />
        <button className="button primary wide" type="submit" disabled={busy}>
          Send reset link
        </button>
        <button className="button subtle wide" type="button" onClick={onBack}>
          Back to login
        </button>
      </form>
    </main>
  );
}

function ResetConfirmScreen({
  busy,
  error,
  onSubmit
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (input: { password: string }) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setLocalError("Passwords do not match");
      return;
    }
    setLocalError(null);
    await onSubmit({ password });
  }

  return (
    <main className="login-shell">
      <form className="login-box" onSubmit={submit}>
        <div className="brand-block">
          <img src="/omnidock-mark.svg" alt="" />
          <div>
            <h1>OmniDock</h1>
            <p>{window.location.host || "Cloudflare Workers"}</p>
          </div>
        </div>
        {error || localError ? (
          <div className="login-error">
            <AlertTriangle size={15} />
            <span>{localError ?? error}</span>
          </div>
        ) : null}
        <label className="field-label" htmlFor="reset-password">
          New password
        </label>
        <input
          id="reset-password"
          className="text-input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={12}
          autoFocus
          required
        />
        <label className="field-label" htmlFor="reset-confirm">
          Confirm password
        </label>
        <input
          id="reset-confirm"
          className="text-input"
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          minLength={12}
          required
        />
        <button className="button primary wide" type="submit" disabled={busy}>
          Save password
        </button>
      </form>
    </main>
  );
}

function AuthStatusScreen({
  busy,
  error,
  onRetry
}: {
  busy: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <main className="login-shell">
      <section className="login-box">
        <div className="brand-block">
          <img src="/omnidock-mark.svg" alt="" />
          <div>
            <h1>OmniDock</h1>
            <p>{window.location.host || "Cloudflare Workers"}</p>
          </div>
        </div>
        <div className={error ? "login-error" : "auth-check"}>
          {error ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
          <span>{error ?? "Checking setup"}</span>
        </div>
        {error ? (
          <button className="button ghost wide" type="button" onClick={onRetry} disabled={busy}>
            <RefreshCw size={16} />
            Retry setup check
          </button>
        ) : null}
      </section>
    </main>
  );
}

function AuthGate({
  error,
  onLock
}: {
  error: string | null;
  onLock: () => void;
}) {
  return (
    <main className="login-shell">
      <section className="login-box">
        <div className="brand-block">
          <img src="/omnidock-mark.svg" alt="" />
          <div>
            <h1>OmniDock</h1>
            <p>{window.location.host || "Cloudflare Workers"}</p>
          </div>
        </div>
        <div className={error ? "login-error" : "auth-check"}>
          {error ? <AlertTriangle size={15} /> : <Loader2 className="spin-icon" size={15} />}
          <span>{error ?? "Opening workspace"}</span>
        </div>
        <button className="button ghost wide" type="button" onClick={onLock}>
          Lock
        </button>
      </section>
    </main>
  );
}

function CustomSelect({
  value,
  options,
  onChange,
  disabled = false,
  title,
  className = ""
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0] ?? { value: "", label: "Select" };

  useEffect(() => {
    if (!open) return;

    function closeOnOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={["custom-select", className, open ? "open" : ""].filter(Boolean).join(" ")} ref={rootRef}>
      <button
        className="custom-select-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled || options.length === 0}
        aria-expanded={open}
        title={title}
      >
        <span>{selected.label}</span>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="custom-select-menu" role="listbox">
          {options.map((option) => (
            <button
              className={[
                "custom-select-option",
                option.value === value ? "active" : "",
                option.disabled ? "disabled" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                setOpen(false);
              }}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled}
            >
              <span>{option.label}</span>
              {option.description ? <small>{option.description}</small> : null}
              {option.value === value ? <CheckCircle2 size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SettingsTitle({
  view,
  activeDomain,
  domains
}: {
  view: SettingsViewKey;
  activeDomain: DomainRow | null;
  domains: DomainRow[];
}) {
  const labels: Record<SettingsViewKey, { title: string; subtitle: string; icon: typeof FolderGit2 }> = {
    rules: {
      title: "Rules",
      subtitle: activeDomain?.domain ?? domains[0]?.domain ?? "Domains",
      icon: FolderGit2
    },
    contacts: {
      title: "Contacts",
      subtitle: "Manual and file import",
      icon: Users
    },
    signatures: {
      title: "Signatures",
      subtitle: "Mailbox based signatures",
      icon: PenLine
    },
    external: {
      title: "External",
      subtitle: "External email accounts",
      icon: Mail
    },
    logs: {
      title: "Logs",
      subtitle: "Activity and error history",
      icon: TerminalSquare
    },
    "index-engine": {
      title: "Index Engine",
      subtitle: "R2 text and OCR index",
      icon: FileText
    },
    notes: {
      title: "Notes",
      subtitle: "Create text files in R2",
      icon: FileText
    },
    "other-settings": {
      title: "Other Settings",
      subtitle: "Refresh and interface",
      icon: SlidersHorizontal
    }
  };
  const item = labels[view];
  const Icon = item.icon;

  return (
    <div className="topbar-title">
      <Icon size={18} />
      <div>
        <strong>{item.title}</strong>
        <span>{item.subtitle}</span>
      </div>
    </div>
  );
}

function BucketTitle({ bucket }: { bucket: BucketRow | null }) {
  return (
    <div className="topbar-title">
      <Server size={18} />
      <div>
        <strong>Buckets</strong>
        <span>{bucket?.name ?? "R2 storage"}</span>
      </div>
    </div>
  );
}

function bucketOptionsForSelect(buckets: BucketRow[]): SelectOption[] {
  return buckets.length === 0
    ? [{ value: "", label: "No buckets" }]
    : buckets.map((bucket) => ({
        value: bucket.id,
        label: bucket.name,
        description: bucket.configured ? bucket.description : `${bucket.binding} binding missing`,
        disabled: !bucket.configured
      }));
}

function externalMailboxScopeId(account: ExternalAccountRow | null | undefined): string {
  return account ? `${EXTERNAL_MAILBOX_SCOPE_PREFIX}${account.id}` : "";
}

function externalAccountFromScope(scopeId: string | null, accounts: ExternalAccountRow[]): ExternalAccountRow | null {
  if (!scopeId?.startsWith(EXTERNAL_MAILBOX_SCOPE_PREFIX)) return null;
  const accountId = scopeId.slice(EXTERNAL_MAILBOX_SCOPE_PREFIX.length);
  return accounts.find((account) => account.id === accountId) ?? null;
}

function combinedMailboxOptions(mailboxes: MailboxRow[], externalAccounts: ExternalAccountRow[]): SelectOption[] {
  return [
    ...mailboxes.map((mailbox) => ({
      value: mailbox.id,
      label: mailbox.address,
      description: "OmniDock mailbox"
    })),
    ...externalAccounts.map((account) => ({
      value: externalMailboxScopeId(account),
      label: account.email,
      description: `${externalProviderLabel(account.provider)} external account`
    }))
  ];
}

function Sidebar({
  managementHost,
  mailboxes,
  externalAccounts,
  buckets,
  stats,
  folder,
  view,
  selectedMailboxId,
  selectedBucketId,
  refreshIntervalSeconds,
  onMailboxChange,
  onBucketOpen,
  onFolderChange,
  onSettingsOpen,
  onLock
}: {
  managementHost: string;
  mailboxes: MailboxRow[];
  externalAccounts: ExternalAccountRow[];
  buckets: BucketRow[];
  stats: Record<string, number>;
  folder: FolderKey;
  view: ViewKey;
  selectedMailboxId: string | null;
  selectedBucketId: string | null;
  refreshIntervalSeconds: number;
  onMailboxChange: (id: string | null) => void;
  onBucketOpen: (id: string) => void;
  onFolderChange: (folder: FolderKey) => void;
  onSettingsOpen: (view: SettingsViewKey) => void;
  onLock: () => void;
}) {
  const bucketOptions = bucketOptionsForSelect(buckets);
  const mailboxOptions = combinedMailboxOptions(mailboxes, externalAccounts);
  const settingsViews = new Set<ViewKey>(["rules", "contacts", "signatures", "external", "logs", "index-engine", "other-settings"]);
  const toolsViews = new Set<ViewKey>(["notes"]);
  const [settingsOpen, setSettingsOpen] = useState(() => settingsViews.has(view));
  const [toolsOpen, setToolsOpen] = useState(() => toolsViews.has(view));
  const settingsItemCount = 7;

  useEffect(() => {
    if (settingsViews.has(view)) setSettingsOpen(true);
    if (toolsViews.has(view)) setToolsOpen(true);
  }, [view]);

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <img src="/omnidock-mark.svg" alt="" />
        <div>
          <strong>OmniDock</strong>
          <span>{managementHost}</span>
        </div>
      </div>

      <label className="mailbox-switcher">
        <span>Mailbox</span>
        <CustomSelect
          value={selectedMailboxId ?? ""}
          onChange={(value) => onMailboxChange(value || null)}
          disabled={mailboxOptions.length === 0}
          options={mailboxOptions.length === 0 ? [{ value: "", label: "No mailboxes" }] : [{ value: "", label: "All mailboxes" }, ...mailboxOptions]}
        />
      </label>

      <nav className="nav-group">
        {folders.map((item) => {
          const Icon = item.icon;
          const active = view === "mail" && folder === item.key;
          return (
            <button
              key={item.key}
              className={active ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => onFolderChange(item.key)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
              <b>{stats[item.key] ?? 0}</b>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-section bucket-switcher">
        <div className="section-title">
          <Server size={14} />
          <span>Buckets</span>
          <b>{buckets.length}</b>
        </div>
        <CustomSelect
          value={selectedBucketId ?? bucketOptions[0]?.value ?? ""}
          onChange={(value) => {
            if (value) onBucketOpen(value);
          }}
          disabled={bucketOptions.length === 0 || buckets.length === 0}
          options={bucketOptions}
          title="Bucket"
        />
      </div>

      <div className="sidebar-section tools-section">
        <button className="section-title section-toggle" type="button" onClick={() => setToolsOpen((current) => !current)}>
          {toolsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Tools</span>
          <b>1</b>
        </button>
        {toolsOpen ? (
          <div className="sidebar-submenu">
            <button className={view === "notes" ? "settings-link active" : "settings-link"} type="button" onClick={() => onSettingsOpen("notes")}>
              <FileText size={16} />
              <span>Notes</span>
              <b>TXT</b>
            </button>
          </div>
        ) : null}
      </div>

      <div className="sidebar-section settings-section">
        <button className="section-title section-toggle" type="button" onClick={() => setSettingsOpen((current) => !current)}>
          {settingsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Settings size={14} />
          <span>Settings</span>
          <b>{settingsItemCount}</b>
        </button>
        {settingsOpen ? (
          <div className="sidebar-submenu">
            <button className={view === "rules" ? "settings-link active" : "settings-link"} type="button" onClick={() => onSettingsOpen("rules")}>
              <FolderGit2 size={16} />
              <span>Rules</span>
              <b>{stats.mailboxes ?? 0}</b>
            </button>
            <button className={view === "contacts" ? "settings-link active" : "settings-link"} type="button" onClick={() => onSettingsOpen("contacts")}>
              <Users size={16} />
              <span>Contacts</span>
              <b>{stats.contacts ?? 0}</b>
            </button>
            <button className={view === "signatures" ? "settings-link active" : "settings-link"} type="button" onClick={() => onSettingsOpen("signatures")}>
              <PenLine size={16} />
              <span>Signatures</span>
              <b>{stats.mailboxes ?? 0}</b>
            </button>
            <button className={view === "external" ? "settings-link active" : "settings-link"} type="button" onClick={() => onSettingsOpen("external")}>
              <Mail size={16} />
              <span>External</span>
              <b>{stats.external_accounts ?? 0}</b>
            </button>
            <button className={view === "logs" ? "settings-link active" : "settings-link"} type="button" onClick={() => onSettingsOpen("logs")}>
              <TerminalSquare size={16} />
              <span>Logs</span>
              <b>{stats.audit_logs ?? 0}</b>
            </button>
            <button className={view === "index-engine" ? "settings-link active" : "settings-link"} type="button" onClick={() => onSettingsOpen("index-engine")}>
              <FileText size={16} />
              <span>Index Engine</span>
              <b>OCR</b>
            </button>
            <button
              className={view === "other-settings" ? "settings-link active" : "settings-link"}
              type="button"
              onClick={() => onSettingsOpen("other-settings")}
            >
              <SlidersHorizontal size={16} />
              <span>Other Settings</span>
              <b>{refreshIntervalSeconds > 0 ? `${refreshIntervalSeconds}s` : "Off"}</b>
            </button>
          </div>
        ) : null}
      </div>

      <button className="button ghost wide lock-button" type="button" onClick={onLock}>
        Lock
      </button>
    </aside>
  );
}

function RulesView({
  api,
  domains,
  mailboxes,
  activeDomain,
  onDomainChange,
  onChange,
  onNotice
}: {
  api: ApiClient | null;
  domains: DomainRow[];
  mailboxes: MailboxRow[];
  activeDomain: DomainRow | null;
  onDomainChange: (id: string | null) => void;
  onChange: () => Promise<void>;
  onNotice: (message: string | null) => void;
}) {
  const selectedDomain = activeDomain ?? domains[0] ?? null;
  const domainMailboxes = selectedDomain
    ? mailboxes.filter((mailbox) => mailbox.domain_id === selectedDomain.id)
    : [];
  const [localPart, setLocalPart] = useState("");
  const [createRule, setCreateRule] = useState(true);
  const [domainsOpen, setDomainsOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function makeDefaultDomain(domain: DomainRow) {
    if (!api || domain.is_default === 1) return;

    setBusyKey("default-domain");
    try {
      await api.setDefaultDomain(domain.id);
      onDomainChange(domain.id);
      await onChange();
      onNotice("Default domain saved");
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function submitMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !selectedDomain || !localPart.trim()) return;

    setBusyKey("mailbox");
    try {
      await api.createMailbox(selectedDomain.id, localPart, null, createRule);
      setLocalPart("");
      await onChange();
      onNotice("Email address saved");
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function enableMailboxRoute(mailbox: MailboxRow) {
    if (!api) return;

    setBusyKey(mailbox.id);
    try {
      await api.enableMailboxRouting(mailbox.id);
      await onChange();
      onNotice("Mailbox routing active");
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function enableCatchAll() {
    if (!api || !selectedDomain) return;

    setBusyKey("catch-all");
    try {
      await api.enableCatchAll(selectedDomain.id);
      await onChange();
      onNotice("Catch-all routing active");
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setBusyKey(null);
    }
  }

  const routedCount = domainMailboxes.filter((mailbox) => mailbox.routing_enabled === 1).length;
  const catchAllActive = selectedDomain?.catch_all_enabled === 1;
  const defaultDomain = domains.find((domain) => domain.is_default === 1) ?? null;
  const isDefaultDomain = selectedDomain?.is_default === 1;
  const routedAddresses = domainMailboxes
    .filter((mailbox) => mailbox.routing_enabled === 1)
    .map((mailbox) => mailbox.address);
  const receivingReady = catchAllActive || routedAddresses.length > 0 || selectedDomain?.routing_enabled === 1;
  const receivingStatus = selectedDomain ? describeReceiving(selectedDomain, routedAddresses, catchAllActive) : null;
  const sendingStatus = selectedDomain ? describeSending(selectedDomain) : null;

  return (
    <section className="rules-shell">
      <div className="rules-domain-drawer">
        <button className="domain-drawer-toggle" type="button" onClick={() => setDomainsOpen((current) => !current)}>
          {domainsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <div>
            <span>Domains</span>
            <strong>{selectedDomain?.domain ?? defaultDomain?.domain ?? "No domains"}</strong>
          </div>
          <b>{domains.length}</b>
        </button>

        {domainsOpen ? (
          <div className="rules-domain-strip">
            {domains.map((domain) => (
              <button
                key={domain.id}
                className={selectedDomain?.id === domain.id ? "domain-chip active" : "domain-chip"}
                type="button"
                onClick={() => onDomainChange(domain.id)}
              >
                <Server size={14} />
                <span>{domain.domain}</span>
                {domain.is_default === 1 ? (
                  <Star size={13} />
                ) : domain.routing_enabled ? (
                  <CheckCircle2 size={13} />
                ) : (
                  <Circle size={13} />
                )}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rules-grid">
        {selectedDomain ? (
        <section className="rules-card mailbox-rule-card">
          <header>
            <div>
              <span>Email address</span>
              <strong>Add @{selectedDomain.domain}</strong>
            </div>
            <Mail size={18} />
          </header>
          <form className="rule-create-form" onSubmit={submitMailbox}>
            <div className="inline-input split">
              <input
                value={localPart}
                onChange={(event) => setLocalPart(event.target.value)}
                placeholder="support"
                disabled={busyKey !== null}
              />
              <span>@{selectedDomain.domain}</span>
              <button
                className="icon-button strong"
                type="submit"
                disabled={busyKey !== null || !localPart.trim()}
                title="Create email address"
              >
                <Plus size={16} />
              </button>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={createRule}
                onChange={(event) => setCreateRule(event.target.checked)}
              />
              Create Worker route for incoming mail
            </label>
          </form>
        </section>
        ) : null}

        {selectedDomain ? (
        <section className="rules-card domain-rule-card">
          <header>
            <div>
              <span>Domain</span>
              <strong>{selectedDomain.domain}</strong>
            </div>
          </header>
          <div className="status-matrix">
            <StatusPill ok={isDefaultDomain} label={isDefaultDomain ? "Default domain" : "Not default"} />
            <StatusPill ok={selectedDomain.sending_enabled === 1} label="Verified sending" />
            <StatusPill ok={receivingReady} label={receivingReady ? "Receiving active" : "Routing inactive"} />
            <StatusPill ok={catchAllActive} label="Catch-all" />
            <StatusPill ok={routedCount > 0 || catchAllActive} label={`${catchAllActive ? "All" : routedCount} routed`} />
          </div>
          {sendingStatus && receivingStatus ? (
            <div className="routing-summary" aria-label="Domain email capability summary">
              <RuleCapabilityItem icon={SendHorizontal} {...sendingStatus} />
              <RuleCapabilityItem icon={Inbox} {...receivingStatus} />
              <RuleCapabilityItem
                icon={FolderGit2}
                tone="info"
                title="Inbound storage required"
                text="Incoming mail is stored only when DB and MAIL_BUCKET bindings are connected. Sending can work even when receiving storage is not ready."
              />
            </div>
          ) : null}
          <div className="domain-card-actions">
            <button
              className="button"
              type="button"
              onClick={() => void makeDefaultDomain(selectedDomain)}
              disabled={busyKey !== null || isDefaultDomain}
            >
              <Star size={16} />
              {isDefaultDomain ? "Default domain" : "Set default"}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => void enableCatchAll()}
              disabled={busyKey !== null || !selectedDomain.zone_id || catchAllActive}
            >
              <FolderGit2 size={16} />
              {catchAllActive ? "Catch-all active" : "Enable catch-all"}
            </button>
          </div>
        </section>
        ) : (
        <section className="rules-card">
          <header>
            <div>
              <span>Domain</span>
              <strong>No domain selected</strong>
            </div>
            <Server size={18} />
          </header>
          <div className="empty-state">Run Sync to load domains from your Cloudflare account.</div>
        </section>
        )}

        {selectedDomain ? (
        <section className="rules-table-card">
          <header>
            <div>
              <span>Addresses</span>
              <strong>{selectedDomain.domain}</strong>
            </div>
          </header>
          <div className="rule-row-list">
            {domainMailboxes.length === 0 ? (
              <div className="empty-state">No mailboxes</div>
            ) : (
              domainMailboxes.map((mailbox) => {
                const mailboxRouted = mailbox.routing_enabled === 1;
                const covered = mailboxRouted || catchAllActive;
                return (
                  <div className="rule-row" key={mailbox.id}>
                    <div className="rule-address">
                      <Mail size={15} />
                      <div>
                        <strong>{mailbox.address}</strong>
                        <span>{mailboxRouted ? "mailbox-rule" : catchAllActive ? "catch-all" : "manual"}</span>
                      </div>
                    </div>
                    <StatusPill ok={covered} label={mailboxRouted ? "Worker route" : catchAllActive ? "Covered" : "No route"} />
                    <button
                      className="button mini"
                      type="button"
                      onClick={() => void enableMailboxRoute(mailbox)}
                      disabled={busyKey !== null || !selectedDomain.zone_id || mailboxRouted}
                    >
                      {mailboxRouted ? "Active" : "Route"}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>
        ) : null}
      </div>
    </section>
  );
}

function createContactDraft(): ContactInput {
  return { email: "", name: "", company: "", phone: "", tags: "", notes: "" };
}

function contactDraftFromRow(contact: ContactRow): ContactInput {
  return {
    email: contact.email,
    name: contact.name ?? "",
    company: contact.company ?? "",
    phone: contact.phone ?? "",
    tags: contact.tags ?? "",
    notes: contact.notes ?? ""
  };
}

function ContactsView({
  api,
  contacts,
  onChange,
  onNotice
}: {
  api: ApiClient | null;
  contacts: ContactRow[];
  onChange: () => Promise<void>;
  onNotice: (message: string | null) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContactInput>(() => createContactDraft());
  const [importLog, setImportLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const dialog = useAppDialog();
  const selectedContact = contacts.find((contact) => contact.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    const contact = contacts.find((item) => item.id === selectedId);
    if (contact) {
      setDraft(contactDraftFromRow(contact));
    } else {
      setSelectedId(null);
      setDraft(createContactDraft());
    }
  }, [contacts, selectedId]);

  function startNewContact() {
    setSelectedId(null);
    setDraft(createContactDraft());
  }

  function editContact(contact: ContactRow) {
    setSelectedId(contact.id);
    setDraft(contactDraftFromRow(contact));
  }

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !draft.email?.trim()) return;

    setBusy(true);
    try {
      const result = await api.saveContact(draft, selectedId);
      setSelectedId(result.contact.id);
      await onChange();
      onNotice(selectedId ? "Contact updated" : "Contact saved");
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeContact() {
    if (!api || !selectedContact) return;
    const confirmed = await dialog.confirm({
      title: "Delete contact",
      message: (
        <>
          Delete <strong>{selectedContact.email}</strong> from contacts?
        </>
      ),
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      await api.deleteContact(selectedContact.id);
      startNewContact();
      await onChange();
      onNotice("Contact deleted");
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File | null) {
    if (!api || !file) return;

    setBusy(true);
    try {
      const parsed = parseContactsFromText(await file.text(), file.name);
      const firstLog = [
        `File: ${file.name}`,
        `Scanned ${parsed.scanned} row${parsed.scanned === 1 ? "" : "s"}.`,
        `Found ${parsed.contacts.length} unique contact${parsed.contacts.length === 1 ? "" : "s"}.`,
        parsed.duplicateEmails > 0 ? `${parsed.duplicateEmails} duplicate email${parsed.duplicateEmails === 1 ? "" : "s"} skipped.` : null,
        parsed.ignoredRows > 0 ? `${parsed.ignoredRows} row${parsed.ignoredRows === 1 ? "" : "s"} without email skipped.` : null
      ].filter(Boolean) as string[];
      setImportLog(firstLog);
      if (parsed.contacts.length === 0) {
        onNotice("No contacts found in file");
        return;
      }
      const result = await api.importContacts(parsed.contacts, file.name.toLowerCase().endsWith(".vcf") ? "vcard" : "upload");
      await onChange();
      const report = result.report;
      setImportLog([
        ...firstLog,
        `Saved ${report.imported}: ${report.created} new, ${report.updated} updated, ${report.skipped} skipped.`,
        ...report.rows.slice(0, 14).map((row) => `${row.status}: ${row.email}${row.message ? ` (${row.message})` : ""}`),
        report.rows.length > 14 ? `${report.rows.length - 14} more rows hidden.` : ""
      ].filter(Boolean));
      onNotice(`${report.imported} contacts saved`);
    } catch (error) {
      setImportLog((current) => [...current, `Error: ${readError(error)}`]);
      onNotice(readError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-shell">
      <div className="settings-grid contacts-grid">
        <section className="settings-card">
          <header>
            <div>
              <span>Manual</span>
              <strong>{selectedContact ? "Edit contact" : "Add contact"}</strong>
            </div>
            <UserPlus size={18} />
          </header>
          <form className="stack-form" onSubmit={submitManual}>
            <label>
              Email
              <input
                value={draft.email ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                placeholder="person@example.com"
              />
            </label>
            <label>
              Name
              <input
                value={draft.name ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Jane Doe"
              />
            </label>
            <label>
	              Company
	              <input
	                value={draft.company ?? ""}
	                onChange={(event) => setDraft((current) => ({ ...current, company: event.target.value }))}
	                placeholder="Example Inc."
	              />
	            </label>
	            <label>
	              Phone
	              <input
	                value={draft.phone ?? ""}
	                onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))}
	                placeholder="+1 555 0100"
	              />
	            </label>
	            <label>
	              Tags
              <input
                value={draft.tags ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                placeholder="lead, support"
              />
            </label>
            <label>
              Notes
              <textarea
                value={draft.notes ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Context"
              />
            </label>
	            <div className="contact-editor-actions">
	              <button className="button primary" type="submit" disabled={busy || !draft.email?.trim()}>
	                <Save size={16} />
	                {selectedContact ? "Update contact" : "Save contact"}
	              </button>
	              <button className="button ghost" type="button" onClick={startNewContact} disabled={busy}>
	                <Plus size={16} />
	                New
	              </button>
	              <button className="button danger" type="button" onClick={() => void removeContact()} disabled={busy || !selectedContact}>
	                <Trash2 size={16} />
	                Delete
	              </button>
	            </div>
	          </form>
	        </section>

        <section className="settings-card">
          <header>
            <div>
              <span>Upload</span>
              <strong>Import file</strong>
            </div>
            <FileUp size={18} />
          </header>
          <label className="file-drop">
            <FileUp size={22} />
            <span>CSV, TXT or VCF</span>
            <input
              type="file"
              accept=".csv,.txt,.vcf,text/csv,text/plain,text/vcard"
	              disabled={busy}
	              onChange={(event) => {
	                void importFile(event.target.files?.[0] ?? null);
	                event.currentTarget.value = "";
	              }}
	            />
	          </label>
	          <p className="settings-note">CSV headers can be email, name, company, phone, tags and notes. Plain text imports every email address it finds.</p>
	          {importLog.length > 0 ? (
	            <div className="import-log" aria-live="polite">
	              {importLog.map((line, index) => (
	                <span key={`${line}-${index}`}>{line}</span>
	              ))}
	            </div>
	          ) : null}
	        </section>

        <section className="settings-table-card">
          <header>
            <div>
              <span>Contacts</span>
              <strong>{contacts.length} saved</strong>
            </div>
          </header>
          <div className="contact-list">
            {contacts.length === 0 ? (
              <div className="empty-state">No contacts</div>
            ) : (
	              contacts.map((contact) => (
	                <button
	                  className={selectedId === contact.id ? "contact-row active" : "contact-row"}
	                  key={contact.id}
	                  type="button"
	                  onClick={() => editContact(contact)}
	                >
	                  <Users size={15} />
	                  <div>
	                    <strong>{contact.name || contact.email}</strong>
	                    <span>{contact.email}</span>
	                    {contact.phone ? (
	                      <small>
	                        <Phone size={12} />
	                        {contact.phone}
	                      </small>
	                    ) : null}
	                  </div>
	                  <b>{contact.company || contact.tags || contact.source}</b>
	                </button>
	              ))
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function SignaturesView({
  api,
  mailboxes,
  signatures,
  onChange,
  onNotice
}: {
  api: ApiClient | null;
  mailboxes: MailboxRow[];
  signatures: MailboxSignatureRow[];
  onChange: () => Promise<void>;
  onNotice: (message: string | null) => void;
}) {
  const [selectedMailboxId, setSelectedMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [signatureDraft, setSignatureDraft] = useState<RichEditorValue>({ html: "", text: "" });
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedMailboxId && mailboxes[0]) {
      setSelectedMailboxId(mailboxes[0].id);
    }
  }, [mailboxes, selectedMailboxId]);

  useEffect(() => {
    const signature = signatures.find((item) => item.mailbox_id === selectedMailboxId);
    setSignatureDraft(createSignatureDraft(signature));
    setEnabled(signature?.enabled !== 0);
  }, [selectedMailboxId, signatures]);

  const selectedMailbox = mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? null;

  async function saveSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !selectedMailbox) return;

    setBusy(true);
    try {
      const htmlSignature = prepareOutgoingHtml(signatureDraft) ?? "";
      await api.saveSignature(selectedMailbox.id, {
        textSignature: signatureDraft.text.trim(),
        htmlSignature,
        enabled
      });
      await onChange();
      onNotice("Signature saved");
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setBusy(false);
    }
  }

  if (mailboxes.length === 0) {
    return (
      <section className="settings-shell empty-detail">
        <Mail size={28} />
        <span>Create a mailbox first</span>
      </section>
    );
  }

  return (
    <section className="settings-shell">
      <div className="signature-grid">
        <section className="settings-table-card">
          <header>
            <div>
              <span>Mailboxes</span>
              <strong>{mailboxes.length} addresses</strong>
            </div>
          </header>
          <div className="signature-mailbox-list">
            {mailboxes.map((mailbox) => {
              const signature = signatures.find((item) => item.mailbox_id === mailbox.id);
              return (
                <button
                  className={selectedMailboxId === mailbox.id ? "signature-mailbox active" : "signature-mailbox"}
                  key={mailbox.id}
                  type="button"
                  onClick={() => setSelectedMailboxId(mailbox.id)}
                >
                  <Mail size={15} />
                  <span>{mailbox.address}</span>
                  {signature?.enabled ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-card signature-editor">
          <header>
            <div>
              <span>Signature</span>
              <strong>{selectedMailbox?.address ?? "Mailbox"}</strong>
            </div>
            <PenLine size={18} />
          </header>
          <form className="signature-form" onSubmit={saveSignature}>
            <div className="signature-status-row">
              <label className="check-row signature-toggle">
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                <span>
                  <strong>{enabled ? "Enabled" : "Disabled"}</strong>
                  <small>{enabled ? "This signature is appended to outgoing mail." : "Outgoing mail will not include this signature."}</small>
                </span>
              </label>
              <StatusPill ok={signatureDraft.text.trim().length > 0} label={signatureDraft.text.trim() ? "Ready" : "Empty"} />
            </div>

            <RichTextEditor value={signatureDraft} onChange={setSignatureDraft} placeholder="Best regards, OmniDock Team" />

            <section className="signature-preview-card">
              <header>
                <span>Preview</span>
                <small>Links and styles are saved as email HTML.</small>
              </header>
              <div
                className={signatureDraft.text.trim() ? "signature-preview-body" : "signature-preview-body empty"}
                dangerouslySetInnerHTML={{
                  __html: signatureDraft.text.trim() ? prepareOutgoingHtml(signatureDraft) ?? "" : "No signature content"
                }}
              />
            </section>

            <div className="signature-actions">
              <button className="button primary" type="submit" disabled={busy || !selectedMailbox}>
                <Save size={16} />
                {busy ? "Saving" : "Save signature"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}

function createSignatureDraft(signature: MailboxSignatureRow | undefined): RichEditorValue {
  if (!signature) {
    return { html: "", text: "" };
  }

  const html = sanitizeEmailHtml(signature.html_signature?.trim() || textToHtmlWithLinks(signature.text_signature));
  return {
    html,
    text: signature.text_signature.trim() || htmlToPlainText(html)
  };
}

function ExternalAccountsView({
  api,
  accounts,
  onChange,
  onNotice
}: {
  api: ApiClient | null;
  accounts: ExternalAccountRow[];
  onChange: () => Promise<void>;
  onNotice: (message: string | null) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExternalAccountInput>(() => createExternalDraft("gmail"));
  const [busy, setBusy] = useState(false);
  const dialog = useAppDialog();
  const credentialSecretName = externalCredentialSecretName(draft.email);

  useEffect(() => {
    if (selectedId && !accounts.some((account) => account.id === selectedId)) {
      setSelectedId(null);
      setDraft(createExternalDraft("gmail"));
    }
  }, [accounts, selectedId]);

  const selectedAccount = accounts.find((account) => account.id === selectedId) ?? null;

  function startNewAccount(provider = "gmail") {
    setSelectedId(null);
    setDraft(createExternalDraft(provider));
  }

  function editAccount(account: ExternalAccountRow) {
    setSelectedId(account.id);
    setDraft(externalDraftFromRow(account));
  }

  function updateDraft(patch: Partial<ExternalAccountInput>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function changeProvider(provider: string) {
    const preset = externalProviderPresets[provider] ?? externalProviderPresets.custom;
    setDraft((current) => ({
      ...current,
      provider,
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      imapSecurity: preset.imapSecurity,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort,
      smtpSecurity: preset.smtpSecurity
    }));
  }

  function changeEmail(email: string) {
    setDraft((current) => ({ ...current, email }));
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !draft.email.trim()) return;

    setBusy(true);
    try {
      const result = await api.saveExternalAccount(
        {
          ...draft,
          username: draft.email.trim(),
          credentialSecretName: credentialSecretName || null
        },
        selectedId
      );
      setSelectedId(result.account.id);
      await onChange();
      if (result.account.inbound_enabled === 1) {
        onNotice(`External account saved. Old mail pull queued for ${result.account.email}.`);
        await api.syncExternalAccount(result.account.id);
        const sync = await pollExternalSyncJobs(api, [result.account], (message) => onNotice(`${result.account.email}: ${message}`));
        await onChange();
        const moreText = sync.timedOut ? " More mail remains; run Sync again to continue from the saved cursor." : "";
        onNotice(`External mail synced: ${formatExternalSyncSummary(sync)}.${moreText}`);
      } else {
        onNotice("External account saved");
      }
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount() {
    if (!api || !selectedAccount) return;
    const confirmed = await dialog.confirm({
      title: "Delete external account",
      message: (
        <>
          Delete <strong>{selectedAccount.email}</strong> from external accounts?
        </>
      ),
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      await api.deleteExternalAccount(selectedAccount.id);
      startNewAccount();
      await onChange();
      onNotice("External account deleted");
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-shell">
      <div className="external-grid">
        <section className="settings-table-card">
          <header>
            <div>
              <span>External accounts</span>
              <strong>{accounts.length} saved</strong>
            </div>
            <button className="button mini" type="button" onClick={() => startNewAccount()} disabled={busy}>
              <Plus size={13} />
              New
            </button>
          </header>
          <div className="external-account-list">
            {accounts.length === 0 ? (
              <div className="empty-state">No external accounts</div>
            ) : (
              accounts.map((account) => (
                <button
                  className={selectedId === account.id ? "external-account-row active" : "external-account-row"}
                  key={account.id}
                  type="button"
                  onClick={() => editAccount(account)}
                >
                  <Mail size={15} />
                  <div>
                    <strong>{account.email}</strong>
                    <span>{externalProviderLabel(account.provider)}</span>
                  </div>
                  <StatusPill ok={account.status === "configured"} label={account.status === "configured" ? "Ready" : "No secret"} />
                </button>
              ))
            )}
          </div>
        </section>

        <section className="settings-card external-editor">
          <header>
            <div>
              <span>Account</span>
              <strong>{selectedAccount?.email ?? "New external account"}</strong>
            </div>
            <Mail size={18} />
          </header>
          <form className="stack-form" onSubmit={saveAccount}>
            <div className="external-form-grid">
              <label>
                Provider
                <CustomSelect
                  value={draft.provider}
                  onChange={changeProvider}
                  options={Object.entries(externalProviderPresets).map(([key, preset]) => ({ value: key, label: preset.label }))}
                />
              </label>
              <label>
                Email
                <input
                  value={draft.email}
                  onChange={(event) => changeEmail(event.target.value)}
                  placeholder="name@gmail.com"
                  autoComplete="email"
                />
              </label>
              <label>
                Display name
                <input value={draft.displayName ?? ""} onChange={(event) => updateDraft({ displayName: event.target.value })} />
              </label>
              <label>
                Auth
                <CustomSelect
                  value={draft.authType}
                  onChange={(value) => updateDraft({ authType: value })}
                  options={[
                    { value: "app_password", label: "App password" },
                    { value: "oauth2", label: "OAuth2" },
                    { value: "none", label: "None" }
                  ]}
                />
              </label>
            </div>

            <div className="external-toggle-row">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.inboundEnabled}
                  onChange={(event) => updateDraft({ inboundEnabled: event.target.checked })}
                />
                Inbound
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.outboundEnabled}
                  onChange={(event) => updateDraft({ outboundEnabled: event.target.checked })}
                />
                Outbound
              </label>
            </div>

            <div className="external-form-grid">
              <label>
                IMAP host
                <input value={draft.imapHost ?? ""} onChange={(event) => updateDraft({ imapHost: event.target.value })} />
              </label>
              <label>
                IMAP port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.imapPort ?? ""}
                  onChange={(event) => updateDraft({ imapPort: event.target.value ? Number(event.target.value) : null })}
                />
              </label>
              <label>
                IMAP security
                <CustomSelect
                  value={draft.imapSecurity}
                  onChange={(value) => updateDraft({ imapSecurity: value })}
                  options={securityOptions}
                />
              </label>
              <label>
                SMTP host
                <input value={draft.smtpHost ?? ""} onChange={(event) => updateDraft({ smtpHost: event.target.value })} />
              </label>
              <label>
                SMTP port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.smtpPort ?? ""}
                  onChange={(event) => updateDraft({ smtpPort: event.target.value ? Number(event.target.value) : null })}
                />
              </label>
              <label>
                SMTP security
                <CustomSelect
                  value={draft.smtpSecurity}
                  onChange={(value) => updateDraft({ smtpSecurity: value })}
                  options={securityOptions}
                />
              </label>
            </div>

            <label>
              Notes
              <textarea value={draft.notes ?? ""} onChange={(event) => updateDraft({ notes: event.target.value })} />
            </label>

            <div className="external-actions">
              <button className="button primary" type="submit" disabled={busy || !draft.email.trim()}>
                <Save size={16} />
                Save account
              </button>
              <button className="button ghost" type="button" onClick={() => startNewAccount(draft.provider)} disabled={busy}>
                <Plus size={16} />
                New
              </button>
              <button className="button danger" type="button" onClick={() => void removeAccount()} disabled={busy || !selectedAccount}>
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}

function createExternalDraft(provider: string): ExternalAccountInput {
  const preset = externalProviderPresets[provider] ?? externalProviderPresets.custom;
  return {
    provider,
    email: "",
    displayName: "",
    username: "",
    authType: "app_password",
    credentialSecretName: "",
    imapHost: preset.imapHost,
    imapPort: preset.imapPort,
    imapSecurity: preset.imapSecurity,
    smtpHost: preset.smtpHost,
    smtpPort: preset.smtpPort,
    smtpSecurity: preset.smtpSecurity,
    inboundEnabled: true,
    outboundEnabled: true,
    notes: ""
  };
}

function externalDraftFromRow(account: ExternalAccountRow): ExternalAccountInput {
  return {
    provider: account.provider,
    email: account.email,
    displayName: account.display_name ?? "",
    username: account.username ?? "",
    authType: account.auth_type,
    credentialSecretName: account.credential_secret_name ?? "",
    imapHost: account.imap_host ?? "",
    imapPort: account.imap_port,
    imapSecurity: account.imap_security,
    smtpHost: account.smtp_host ?? "",
    smtpPort: account.smtp_port,
    smtpSecurity: account.smtp_security,
    inboundEnabled: account.inbound_enabled === 1,
    outboundEnabled: account.outbound_enabled === 1,
    notes: account.notes ?? ""
  };
}

function externalProviderLabel(provider: string): string {
  return externalProviderPresets[provider]?.label ?? provider;
}

function externalCredentialSecretName(email: string): string {
  return email.trim().toLowerCase();
}

function sendableFromOptions(mailboxes: MailboxRow[], externalAccounts: ExternalAccountRow[]): SelectOption[] {
  const seen = new Set<string>();
  const options: SelectOption[] = [];

  for (const mailbox of mailboxes) {
    if (mailbox.enabled !== 1) continue;
    const address = mailbox.address.toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);
    options.push({ value: mailbox.address, label: mailbox.address, description: "OmniDock mailbox" });
  }

  for (const account of externalAccounts) {
    if (account.outbound_enabled !== 1) continue;
    const address = account.email.toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);
    options.push({
      value: account.email,
      label: account.email,
      description: `${externalProviderLabel(account.provider)} external`
    });
  }

  return options;
}

async function pollExternalSyncJobs(
  api: ApiClient,
  accounts: ExternalAccountRow[],
  onProgress?: (message: string) => void
): Promise<{
  imported: number;
  skipped: number;
  checked: number;
  timedOut: boolean;
  failed: number;
}> {
  const startedAt = Date.now();
  let lastKickAt = 0;
  const accountIds = new Set(accounts.map((account) => account.id));
  const accountNames = new Map(accounts.map((account) => [account.id, account.email]));
  let latestJobs: ExternalSyncJobRow[] = [];
  let lastProgressSignature = "";
  let lastProgressAt = startedAt;

  for (;;) {
    const payload = await api.externalSyncJobs();
    latestJobs = payload.jobs.filter((job) => accountIds.has(job.account_id));
    const summary = summarizeExternalSyncJobs(latestJobs);
    onProgress?.(formatExternalSyncProgress(latestJobs, accountNames, summary));
    const progressSignature = latestJobs
      .map((job) => [job.account_id, job.status, job.updated_at, job.imported, job.skipped, job.checked, job.message ?? ""].join(":"))
      .join("|");
    if (progressSignature !== lastProgressSignature) {
      lastProgressSignature = progressSignature;
      lastProgressAt = Date.now();
    }

    const active = latestJobs.filter(isActiveExternalSyncJob);
    if (active.length === 0) {
      return { ...summary, timedOut: false };
    }

    if (Date.now() - lastProgressAt >= EXTERNAL_SYNC_UI_STALE_MS) {
      await api.resumeExternalSync().catch(() => undefined);
      return { ...summary, timedOut: true };
    }

    if (Date.now() - lastKickAt > 20_000) {
      lastKickAt = Date.now();
      await api.resumeExternalSync().catch(() => undefined);
    }

    if (Date.now() - startedAt >= EXTERNAL_SYNC_UI_MAX_WAIT_MS) {
      return { ...summary, timedOut: true };
    }

    await delay(EXTERNAL_SYNC_POLL_INTERVAL_MS);
  }
}

function summarizeExternalSyncJobs(jobs: ExternalSyncJobRow[]): { imported: number; skipped: number; checked: number; failed: number } {
  return jobs.reduce(
    (total, job) => ({
      imported: total.imported + job.imported,
      skipped: total.skipped + job.skipped,
      checked: total.checked + job.checked,
      failed: total.failed + (job.status === "failed" ? 1 : 0)
    }),
    { imported: 0, skipped: 0, checked: 0, failed: 0 }
  );
}

function formatExternalSyncSummary(summary: { imported: number; skipped: number; checked: number }): string {
  return `${summary.imported} new, ${summary.skipped} already saved, ${summary.checked} checked`;
}

function formatExternalSyncProgress(
  jobs: ExternalSyncJobRow[],
  accountNames: Map<string, string>,
  summary: { imported: number; skipped: number; checked: number; failed: number }
): string {
  const running = jobs.find((job) => job.status === "running");
  const queued = jobs.filter((job) => job.status === "queued").length;
  const active = running ?? jobs.find((job) => job.status === "queued");
  const activeName = active ? accountNames.get(active.account_id) ?? active.account_id : null;
  const state = active
    ? `${activeName}: ${active.status}${active.message ? ` - ${active.message}` : ""}`
    : summary.failed > 0
      ? `${summary.failed} external inbox failed`
      : "External inbox pull complete";
  const queuedText = queued > 0 ? `, ${queued} queued` : "";
  return `${state}${queuedText} | ${formatExternalSyncSummary(summary)}`;
}

function isActiveExternalSyncJob(job: ExternalSyncJobRow): boolean {
  return job.status === "queued" || job.status === "running";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function LogsView({
  api,
  onNotice
}: {
  api: ApiClient | null;
  onNotice: (message: string | null) => void;
}) {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const dialog = useAppDialog();

  const loadLogs = useCallback(
    async (nextQuery: string) => {
      if (!api) return;
      setLoading(true);
      setError(null);
      try {
        const payload = await api.auditLogs({ query: nextQuery, limit: 350 });
        setLogs(payload.logs);
        setSelectedIds((current) => new Set([...current].filter((id) => payload.logs.some((log) => log.id === id))));
      } catch (loadError) {
        const message = readError(loadError);
        setError(message);
        onNotice(`Logs failed: ${message}`);
      } finally {
        setLoading(false);
      }
    },
    [api, onNotice]
  );

  useEffect(() => {
    void loadLogs("");
  }, [loadLogs]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanQuery = query.trim();
    setAppliedQuery(cleanQuery);
    void loadLogs(cleanQuery);
  }

  function clearSearch() {
    setQuery("");
    setAppliedQuery("");
    void loadLogs("");
  }

  const selectedLogs = logs.filter((log) => selectedIds.has(log.id));
  const allVisibleSelected = logs.length > 0 && selectedIds.size === logs.length;

  function toggleAllVisible() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(logs.map((log) => log.id)));
  }

  function toggleLog(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function exportLogs(format: "csv" | "json", rows = logs) {
    if (rows.length === 0) {
      onNotice("No logs to export");
      return;
    }

    const body = format === "json" ? JSON.stringify(rows, null, 2) : logsToCsv(rows);
    downloadTextFile(`omnidock-logs-${new Date().toISOString().slice(0, 10)}.${format}`, body, format === "json" ? "application/json" : "text/csv");
    onNotice(`Exported ${rows.length} log row${rows.length === 1 ? "" : "s"}`);
  }

  async function deleteOne(log: AuditLogRow) {
    if (!api) return;
    const confirmed = await dialog.confirm({
      title: "Delete log row",
      message: `Delete "${humanizeAuditAction(log.action)}" from the database?`,
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await api.deleteAuditLog(log.id);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(log.id);
        return next;
      });
      await loadLogs(appliedQuery);
      onNotice(`Deleted ${result.deleted} log row`);
    } catch (deleteError) {
      const message = readError(deleteError);
      setError(message);
      onNotice(`Delete failed: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteSelected() {
    if (!api || selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = await dialog.confirm({
      title: "Delete selected logs",
      message: `Delete ${count} selected log row${count === 1 ? "" : "s"} from the database?`,
      confirmLabel: "Delete selected",
      tone: "danger"
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await api.deleteAuditLogs([...selectedIds]);
      setSelectedIds(new Set());
      await loadLogs(appliedQuery);
      onNotice(`Deleted ${result.deleted} log rows`);
    } catch (deleteError) {
      const message = readError(deleteError);
      setError(message);
      onNotice(`Delete failed: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function clearAllLogs() {
    if (!api) return;
    const confirmed = await dialog.confirm({
      title: "Clear all logs",
      message: "Delete every log row from the database? A new cleanup log row will be written after the clear.",
      confirmLabel: "Clear logs",
      tone: "danger"
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await api.clearAuditLogs();
      setSelectedIds(new Set());
      await loadLogs("");
      setQuery("");
      setAppliedQuery("");
      onNotice(`Cleared ${result.deleted} log rows`);
    } catch (deleteError) {
      const message = readError(deleteError);
      setError(message);
      onNotice(`Clear failed: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="settings-shell logs-shell">
      <section className="settings-table-card logs-card">
        <header>
          <div>
            <span>Activity log</span>
            <strong>{loading ? "Loading" : `${logs.length} rows`}</strong>
          </div>
          <form className="log-toolbar" onSubmit={submit}>
            <div className="search-wrap compact">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search action, target, detail"
              />
            </div>
            <button className="button" type="submit" disabled={loading}>
              <Search size={15} />
              Search
            </button>
            {appliedQuery ? (
              <button className="button ghost" type="button" onClick={clearSearch} disabled={loading}>
                <X size={15} />
                Clear
              </button>
            ) : null}
            <button className="button" type="button" onClick={() => void loadLogs(appliedQuery)} disabled={loading}>
              {loading ? <Loader2 className="spin-icon" size={15} /> : <RefreshCw size={15} />}
              Refresh
            </button>
            <button className="button" type="button" onClick={() => exportLogs("csv")} disabled={loading || logs.length === 0}>
              <Download size={15} />
              CSV
            </button>
            <button className="button" type="button" onClick={() => exportLogs("json", selectedLogs.length ? selectedLogs : logs)} disabled={loading || logs.length === 0}>
              <FileText size={15} />
              JSON
            </button>
            <button className="button danger" type="button" onClick={() => void deleteSelected()} disabled={loading || selectedIds.size === 0}>
              <Trash2 size={15} />
              Delete selected
            </button>
            <button className="button danger" type="button" onClick={() => void clearAllLogs()} disabled={loading || logs.length === 0}>
              <Trash2 size={15} />
              Clear all
            </button>
          </form>
        </header>
        {error ? (
          <div className="login-error compact log-error">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        ) : null}
        <div className="log-table-wrap">
          {logs.length === 0 ? (
            <div className="empty-list">
              <TerminalSquare size={22} />
              <span>No log rows</span>
            </div>
          ) : (
            <table className="log-table">
              <thead>
                <tr>
                  <th>
                    <button className="check-button" type="button" onClick={toggleAllVisible} title={allVisibleSelected ? "Unselect all" : "Select all"}>
                      {allVisibleSelected ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                    </button>
                  </th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Details</th>
                  <th>Tools</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const metadata = parseAuditMetadata(log.metadata_json);
                  const status = auditLogStatus(log, metadata);
                  const StatusIcon = status.icon;
                  return (
                    <tr className={status.tone === "error" ? "error-row" : ""} key={log.id}>
                      <td>
                        <button
                          className="check-button"
                          type="button"
                          onClick={() => toggleLog(log.id)}
                          title={selectedIds.has(log.id) ? "Unselect row" : "Select row"}
                        >
                          {selectedIds.has(log.id) ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                        </button>
                      </td>
                      <td>
                        <time>{formatDate(log.created_at)}</time>
                      </td>
                      <td>
                        <span className={`status-pill ${status.tone}`}>
                          <StatusIcon size={13} />
                          {status.label}
                        </span>
                      </td>
                      <td>
                        <strong>{humanizeAuditAction(log.action)}</strong>
                        <small>{log.actor}</small>
                      </td>
                      <td>
                        <code>{log.target ?? "system"}</code>
                      </td>
                      <td>
                        <span>{summarizeAuditMetadata(metadata)}</span>
                      </td>
                      <td>
                        <div className="log-row-actions">
                          <button className="icon-button" type="button" onClick={() => exportLogs("json", [log])} title="Export row">
                            <Download size={14} />
                          </button>
                          <button className="icon-button danger" type="button" onClick={() => void deleteOne(log)} title="Delete row">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </section>
  );
}

function IndexEngineView({
  api,
  buckets,
  onNotice
}: {
  api: ApiClient | null;
  buckets: BucketRow[];
  onNotice: (message: string | null) => void;
}) {
  const [payload, setPayload] = useState<BucketIndexPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [runningNow, setRunningNow] = useState(false);

  const loadStatus = useCallback(
    async (silent = false) => {
      if (!api) return;
      if (!silent) setLoading(true);
      try {
        const next = await api.bucketIndexStatus();
        setPayload(next);
      } catch (error) {
        onNotice(`Index Engine failed: ${readError(error)}`);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [api, onNotice]
  );

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const job = payload?.job ?? null;
  const active = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    if (!api || !active) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await api.bucketIndexStatus();
        if (!cancelled) setPayload(next);
      } catch (error) {
        if (!cancelled) onNotice(`Index Engine status failed: ${readError(error)}`);
      }
    };

    const timer = window.setInterval(() => void poll(), 3000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, api, onNotice]);

  async function startIndex() {
    if (!api) return;
    setStarting(true);
    try {
      const next = await api.startBucketIndex();
      setPayload(next);
      onNotice("Index Engine queued. It will continue in background and scheduled Worker runs.");
    } catch (error) {
      onNotice(`Index Engine could not start: ${readError(error)}`);
    } finally {
      setStarting(false);
    }
  }

  async function continueIndex() {
    if (!api) return;
    setRunningNow(true);
    try {
      const next = await api.runBucketIndex();
      setPayload(next);
      onNotice("Index Engine runner requested. Status will update automatically.");
    } catch (error) {
      onNotice(`Index Engine runner failed: ${readError(error)}`);
    } finally {
      setRunningNow(false);
    }
  }

  const currentBuckets = payload?.buckets ?? buckets;
  const configuredBuckets = currentBuckets.filter((bucket) => bucket.configured);
  let configuredPosition = 0;
  const bucketRows = currentBuckets.map((bucket) => ({
    bucket,
    position: bucket.configured ? configuredPosition++ : -1
  }));
  const progressPercent = bucketIndexProgress(job, configuredBuckets.length);
  const JobIcon = job?.status === "running" || job?.status === "queued" ? Loader2 : job?.status === "failed" ? AlertTriangle : CheckCircle2;
  const aiConfigured = payload?.aiConfigured ?? false;

  return (
    <section className="settings-shell index-engine-shell">
      <div className="index-engine-grid">
        <section className="settings-card index-engine-card index-engine-hero">
          <header>
            <div>
              <span>Index Engine</span>
              <strong>{bucketIndexStatusLabel(job)}</strong>
            </div>
            <span className={`status-pill ${bucketIndexTone(job)}`}>
              <JobIcon className={active ? "spin-icon" : undefined} size={13} />
              {job?.status ?? "idle"}
            </span>
          </header>
          <p>
            Index Engine scans every configured R2 bucket, extracts searchable text, and stores the index in D1. Unchanged files are skipped by
            object size and ETag, so repeat runs do not duplicate work.
          </p>
          <div className="bucket-upload-progress index-progress" aria-hidden="true">
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="index-engine-actions">
            <button className="button primary" type="button" disabled={!api || starting || active || configuredBuckets.length === 0} onClick={() => void startIndex()}>
              {starting || active ? <Loader2 className="spin-icon" size={15} /> : <Search size={15} />}
              {active ? "Indexing" : "Index all buckets"}
            </button>
            <button className="button ghost" type="button" disabled={!api || runningNow || configuredBuckets.length === 0} onClick={() => void continueIndex()}>
              {runningNow ? <Loader2 className="spin-icon" size={15} /> : <RefreshCw size={15} />}
              Continue now
            </button>
            <button className="button ghost" type="button" disabled={!api || loading} onClick={() => void loadStatus()}>
              {loading ? <Loader2 className="spin-icon" size={15} /> : <RefreshCw size={15} />}
              Refresh status
            </button>
          </div>
        </section>

        <section className="settings-card index-engine-card">
          <header>
            <div>
              <span>OCR Runtime</span>
              <strong>{aiConfigured ? "Workers AI connected" : "Workers AI not connected"}</strong>
            </div>
            {aiConfigured ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          </header>
          <p>
            PDF, image, Office, and spreadsheet files use Cloudflare Workers AI Markdown Conversion when the Worker has an AI binding. Text files
            and searchable PDF text layers are indexed without AI.
          </p>
          <div className={aiConfigured ? "index-engine-note ok" : "index-engine-note warn"}>
            {aiConfigured
              ? "OCR/document extraction is available for supported files."
              : "Deploy with an AI binding named AI to enable OCR-style extraction for images and scanned documents."}
          </div>
        </section>

        <section className="settings-card index-engine-card">
          <header>
            <div>
              <span>Run Counters</span>
              <strong>{job ? `${job.scanned} scanned` : "No run yet"}</strong>
            </div>
            <FileText size={18} />
          </header>
          <div className="index-counter-grid">
            <IndexCounter label="Indexed" value={job?.indexed ?? 0} />
            <IndexCounter label="OCR" value={job?.ocr_indexed ?? 0} />
            <IndexCounter label="Skipped" value={job?.skipped ?? 0} />
            <IndexCounter label="Failed" value={job?.failed ?? 0} />
          </div>
          <p className="settings-note">
            {job?.message ?? "Start a run to build the searchable R2 text index."}
            {job?.last_error ? ` Last error: ${job.last_error}` : ""}
          </p>
        </section>

        <section className="settings-card index-engine-card">
          <header>
            <div>
              <span>Buckets</span>
              <strong>{configuredBuckets.length} configured</strong>
            </div>
            <Server size={18} />
          </header>
          <div className="bucket-index-list">
            {bucketRows.map((row) => (
              <div className={row.bucket.configured ? "bucket-index-row" : "bucket-index-row muted"} key={row.bucket.id}>
                <span>{row.bucket.name}</span>
                <small>{row.bucket.configured ? (job && row.position < job.bucket_index ? "done" : "ready") : "missing binding"}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-card index-engine-card wide">
          <header>
            <div>
              <span>Logs</span>
              <strong>Audit trail connected</strong>
            </div>
            <TerminalSquare size={18} />
          </header>
          <p>
            Successful objects are written as bucket.object_indexed; extraction failures are written as bucket.object_index_failed. Open Logs and
            search bucket.index or bucket.object to inspect the run.
          </p>
        </section>
      </div>
    </section>
  );
}

function IndexCounter({ label, value }: { label: string; value: number }) {
  return (
    <div className="index-counter">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function bucketIndexProgress(job: BucketIndexJobRow | null, bucketCount: number): number {
  if (!job) return 0;
  if (job.status === "complete") return 100;
  if (bucketCount <= 0) return 0;
  return Math.max(0, Math.min(99, Math.round((job.bucket_index / bucketCount) * 100)));
}

function bucketIndexStatusLabel(job: BucketIndexJobRow | null): string {
  if (!job) return "Not started";
  if (job.status === "queued") return "Queued";
  if (job.status === "running") return "Running";
  if (job.status === "complete") return "Complete";
  return "Failed";
}

function bucketIndexTone(job: BucketIndexJobRow | null): "ok" | "warn" | "error" {
  if (!job) return "warn";
  if (job.status === "complete") return "ok";
  if (job.status === "failed") return "error";
  return "warn";
}

function NotesView({
  api,
  buckets,
  activeBucketId,
  onBucketChange,
  onNotice
}: {
  api: ApiClient | null;
  buckets: BucketRow[];
  activeBucketId: string | null;
  onBucketChange: (bucketId: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const writableBuckets = buckets.filter((bucket) => bucket.configured && bucket.writable);
  const activeBucket =
    writableBuckets.find((bucket) => bucket.id === activeBucketId) ?? writableBuckets[0] ?? buckets.find((bucket) => bucket.id === activeBucketId) ?? null;
  const [folderPath, setFolderPath] = useState("notes");
  const [filename, setFilename] = useState(defaultNoteFilename);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const bucketOptions = bucketOptionsForSelect(buckets);
  const normalizedPrefix = normalizeNotesPrefix(folderPath);
  const normalizedFilename = normalizeNoteFilename(filename);
  const objectKey = buildR2UploadKey(normalizedPrefix, normalizedFilename);
  const canSave = Boolean(api && activeBucket?.writable && normalizedFilename && content.trim());

  useEffect(() => {
    if (activeBucket && activeBucket.id !== activeBucketId) {
      onBucketChange(activeBucket.id);
    }
  }, [activeBucket, activeBucketId, onBucketChange]);

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !activeBucket) return;
    if (!activeBucket.writable) {
      onNotice("Selected bucket is not writable");
      return;
    }
    if (!content.trim()) {
      onNotice("Note content cannot be empty");
      return;
    }

    setSaving(true);
    try {
      const file = new File([content], normalizedFilename, { type: "text/plain;charset=utf-8" });
      await api.uploadBucketObject(activeBucket.id, objectKey, file);
      onNotice(`Note saved to ${activeBucket.name}/${objectKey}`);
      setContent("");
      setFilename(defaultNoteFilename());
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-shell notes-shell">
      <section className="settings-card notes-editor">
        <header>
          <div>
            <span>New note</span>
            <strong>{objectKey || "Choose a destination"}</strong>
          </div>
          <FileText size={18} />
        </header>
        <form className="notes-form" onSubmit={saveNote}>
          <div className="notes-destination-grid">
            <label>
              Bucket
              <CustomSelect
                value={activeBucket?.id ?? ""}
                onChange={(value) => onBucketChange(value || null)}
                disabled={bucketOptions.length === 0}
                options={bucketOptions}
                title="Note bucket"
              />
            </label>
            <label>
              Folder
              <input value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="notes/project" />
            </label>
            <label>
              File name
              <input value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="note.txt" />
            </label>
          </div>
          <label className="notes-body-field">
            Text
            <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write a note..." />
          </label>
          <div className="notes-save-row">
            <span title={objectKey}>{activeBucket ? `${activeBucket.name}/${objectKey}` : "No writable bucket selected"}</span>
            <button className="button primary" type="submit" disabled={!canSave || saving}>
              {saving ? <Loader2 className="spin-icon" size={15} /> : <Save size={15} />}
              {saving ? "Saving" : "Save note"}
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}

function OtherSettingsView({
  refreshIntervalSeconds,
  onRefreshIntervalChange
}: {
  refreshIntervalSeconds: number;
  onRefreshIntervalChange: (seconds: number) => void;
}) {
  const presetValues = [0, 5, 10, 30, 60, 120];

  return (
    <section className="settings-shell">
      <div className="other-settings-grid">
        <section className="settings-card">
          <header>
            <div>
              <span>Refresh</span>
              <strong>{refreshIntervalSeconds > 0 ? `${refreshIntervalSeconds} seconds` : "Off"}</strong>
            </div>
            <RefreshCw size={18} />
          </header>
          <div className="setting-control">
            <label>
              Auto refresh
              <div className="number-control">
                <input
                  type="number"
                  min={0}
                  max={300}
                  step={1}
                  value={refreshIntervalSeconds}
                  onChange={(event) => onRefreshIntervalChange(Number(event.target.value))}
                />
                <span>seconds</span>
              </div>
            </label>
            <div className="preset-row" aria-label="Refresh presets">
              {presetValues.map((value) => (
                <button
                  className={refreshIntervalSeconds === value ? "button mini active" : "button mini"}
                  key={value}
                  type="button"
                  onClick={() => onRefreshIntervalChange(value)}
                >
                  {value === 0 ? "Off" : `${value}s`}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function BucketsView({
  api,
  buckets,
  activeBucketId,
  onBucketChange,
  onNotice
}: {
  api: ApiClient | null;
  buckets: BucketRow[];
  activeBucketId: string | null;
  onBucketChange: (bucketId: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const activeBucket = buckets.find((bucket) => bucket.id === activeBucketId) ?? buckets[0] ?? null;
  const [prefix, setPrefix] = useState("");
  const [folders, setFolders] = useState<BucketFolderRow[]>([]);
  const [objects, setObjects] = useState<BucketObjectRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [uploadState, setUploadState] = useState<BucketUploadState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<BucketSearchScope>("current");
  const [searchIncludesText, setSearchIncludesText] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<BucketSearchResultRow[] | null>(null);
  const [searchMeta, setSearchMeta] = useState<{
    scanned: number;
    contentScanned: number;
    contentErrors: number;
    durationMs: number;
    includedText: boolean;
    timedOut: boolean;
    truncated: boolean;
  } | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const dialog = useAppDialog();
  const bucketOptions = bucketOptionsForSelect(buckets);
  const searchScopeOptions: SelectOption[] = [
    { value: "current", label: "This bucket" },
    { value: "all", label: "All buckets" }
  ];
  const displayedObjects: BucketDisplayObjectRow[] = searchResults ?? objects;
  const selectedObject = displayedObjects.find((object) => bucketObjectSelectionId(object) === selectedKey) ?? null;
  const selectedObjectBucket = selectedObject?.bucketId ? buckets.find((bucket) => bucket.id === selectedObject.bucketId) ?? activeBucket : activeBucket;
  const uploading = Boolean(uploadState?.active);

  async function loadObjects(nextPrefix = prefix, nextCursor: string | null = null, append = false) {
    if (!api || !activeBucket) return;
    setLoading(true);
    try {
      const data = await api.listBucketObjects(activeBucket.id, nextPrefix, nextCursor);
      const nextObjects = append ? [...objects, ...data.objects] : data.objects;
      setFolders(data.folders);
      setObjects(nextObjects);
      setCursor(data.cursor);
      setSelectedKey((current) => (current && nextObjects.some((object) => object.key === current) ? current : nextObjects[0]?.key ?? null));
      onNotice(null);
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!activeBucketId && buckets[0]) {
      onBucketChange(buckets[0].id);
    }
  }, [activeBucketId, buckets, onBucketChange]);

  useEffect(() => {
    setPrefix("");
    setSelectedKey(null);
    setSearchResults(null);
    setSearchMeta(null);
  }, [activeBucket?.id]);

  useEffect(() => {
    void loadObjects(prefix, null, false);
  }, [api, activeBucket?.id, prefix]);

  async function runBucketSearch() {
    const query = searchQuery.trim();
    if (!api || !activeBucket || query.length < 2) {
      setSearchResults(null);
      setSearchMeta(null);
      if (query.length > 0) onNotice("Search needs at least 2 characters");
      return;
    }

    setSearching(true);
    try {
      const data = await api.searchBucketObjects({
        bucketId: activeBucket.id,
        query,
        allBuckets: searchScope === "all",
        includeText: searchIncludesText
      });
      setSearchResults(data.results);
      setSearchMeta({
        scanned: data.scanned,
        contentScanned: data.contentScanned,
        contentErrors: data.contentErrors,
        durationMs: data.durationMs,
        includedText: searchIncludesText,
        timedOut: data.timedOut,
        truncated: data.truncated
      });
      setSelectedKey(data.results[0] ? bucketObjectSelectionId(data.results[0]) : null);
      const details = [
        `${(data.durationMs / 1000).toFixed(1)}s`,
        data.timedOut ? "time limit reached" : "",
        data.contentErrors > 0 ? `${data.contentErrors} scan issue${data.contentErrors === 1 ? "" : "s"}` : "",
        data.truncated ? "more available" : ""
      ].filter(Boolean);
      onNotice(
        `Search found ${data.results.length} result${data.results.length === 1 ? "" : "s"}${
          details.length > 0 ? ` (${details.join(", ")})` : ""
        }`
      );
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setSearching(false);
    }
  }

  function clearBucketSearch() {
    setSearchQuery("");
    setSearchResults(null);
    setSearchMeta(null);
    setSelectedKey((current) => (current && objects.some((object) => object.key === current) ? current : objects[0]?.key ?? null));
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0 || !api || !activeBucket) return;
    const selectedFiles = Array.from(files);
    const entries = selectedFiles.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      name: file.name || "upload",
      key: buildR2UploadKey(prefix, file.name),
      size: file.size,
      status: "queued" as const
    }));
    setUploadState({ active: true, total: selectedFiles.length, completed: 0, entries });
    onNotice(null);
    let uploaded = 0;
    let failed = 0;

    try {
      for (const [index, file] of selectedFiles.entries()) {
        const entry = entries[index];
        setUploadState((current) => updateBucketUploadEntry(current, entry.id, { status: "uploading", message: "Uploading" }));
        try {
          await api.uploadBucketObject(activeBucket.id, entry.key, file);
          uploaded += 1;
          setUploadState((current) =>
            updateBucketUploadEntry(current, entry.id, {
              status: "done",
              message: `Uploaded ${formatBytes(file.size)}`
            })
          );
        } catch (error) {
          failed += 1;
          setUploadState((current) =>
            updateBucketUploadEntry(current, entry.id, {
              status: "error",
              message: readError(error)
            })
          );
        } finally {
          setUploadState((current) => (current ? { ...current, completed: Math.min(current.completed + 1, current.total) } : current));
        }
      }

      if (uploaded > 0) {
        await loadObjects(prefix, null, false);
      }
      onNotice(
        failed > 0
          ? `Uploaded ${uploaded} object${uploaded === 1 ? "" : "s"}, ${failed} failed`
          : `Uploaded ${uploaded} object${uploaded === 1 ? "" : "s"}`
      );
    } finally {
      setUploadState((current) => (current ? { ...current, active: false } : current));
    }
  }

  async function createFolder() {
    if (!api || !activeBucket) return;
    const input = await dialog.prompt({
      title: "New folder",
      message: (
        <>
          Create a folder under <strong>{prefix || "/"}</strong>. Use slashes for subfolders, for example{" "}
          <strong>reports/2026</strong>.
        </>
      ),
      placeholder: "new-folder",
      confirmLabel: "Create folder"
    });
    if (input === null) return;
    const path = input.trim();
    if (!path) {
      onNotice("Folder name cannot be empty");
      return;
    }

    setCreatingFolder(true);
    try {
      const data = await api.createBucketFolder(activeBucket.id, prefix, path);
      setSearchResults(null);
      setSearchMeta(null);
      setSelectedKey(null);
      setPrefix(data.folder.key);
      onNotice(`Folder created: ${data.folder.key}`);
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setCreatingFolder(false);
    }
  }

  async function deleteObject(object: BucketDisplayObjectRow) {
    const targetBucket = object.bucketId ? buckets.find((bucket) => bucket.id === object.bucketId) ?? null : activeBucket;
    if (!api || !targetBucket) return;
    const confirmed = await dialog.confirm({
      title: "Delete R2 object",
      message: (
        <>
          Delete <strong>{object.key}</strong> from <strong>{targetBucket.name}</strong>? This cannot be undone.
        </>
      ),
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      await api.deleteBucketObject(targetBucket.id, object.key);
      setSelectedKey(null);
      if (searchResults) {
        await runBucketSearch();
      } else {
        await loadObjects(prefix, null, false);
      }
      onNotice("R2 object deleted");
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setLoading(false);
    }
  }

  if (buckets.length === 0) {
    return (
      <section className="settings-shell empty-detail">
        <Server size={28} />
        <span>No R2 bucket binding</span>
      </section>
    );
  }

  return (
    <section className="bucket-shell">
      <div className="bucket-toolbar">
        <div className="bucket-current bucket-select" title={activeBucket?.description ?? "R2 bucket"}>
          <CustomSelect
            value={activeBucket?.id ?? bucketOptions[0]?.value ?? ""}
            onChange={(value) => onBucketChange(value || null)}
            disabled={buckets.length === 0}
            options={bucketOptions}
            title="Bucket"
          />
        </div>
        <form
          className="bucket-searchbar"
          onSubmit={(event) => {
            event.preventDefault();
            void runBucketSearch();
          }}
        >
          <div className="bucket-search-input">
            <Search size={15} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search files, paths, text"
            />
          </div>
          <CustomSelect
            value={searchScope}
            onChange={(value) => setSearchScope(value === "all" ? "all" : "current")}
            options={searchScopeOptions}
            title="Search scope"
            className="bucket-search-scope"
          />
          <button
            className={searchIncludesText ? "button mini active" : "button mini"}
            type="button"
            onClick={() => setSearchIncludesText((current) => !current)}
            title="Search filenames, paths, saved indexes, text files, searchable PDFs, and OCR output created by Index Engine."
          >
            <FileText size={14} />
            Text/PDF
          </button>
          <button className="button primary" type="submit" disabled={searching || searchQuery.trim().length < 2}>
            {searching ? <Loader2 className="spin-icon" size={15} /> : <Search size={15} />}
            {searching ? "Searching" : "Search"}
          </button>
          {searchResults ? (
            <button className="button ghost" type="button" onClick={clearBucketSearch}>
              <X size={15} />
              Clear
            </button>
          ) : null}
        </form>
        <div className="bucket-actions">
          <label className={uploading ? "button primary file-button is-loading" : "button primary file-button"}>
            {uploading ? <Loader2 size={15} /> : <FileUp size={15} />}
            <span>{uploading ? "Uploading" : "Upload"}</span>
            <input
              type="file"
              multiple
              disabled={uploading || loading || !activeBucket?.writable}
              onChange={(event) => {
                void uploadFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button className="button ghost" type="button" onClick={() => void loadObjects(prefix, null, false)} disabled={loading}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </div>

      {uploadState ? <BucketUploadLog state={uploadState} /> : null}

      <div className="bucket-pathbar">
        <button className={!prefix ? "button mini active" : "button mini"} type="button" onClick={() => setPrefix("")}>
          /
        </button>
        {prefixParts(prefix).map((part) => (
          <button className="button mini" key={part.prefix} type="button" onClick={() => setPrefix(part.prefix)}>
            {part.name}
          </button>
        ))}
      </div>

      <div className="bucket-layout">
        <section className="bucket-panel folder-panel">
          <header>
            <div>
              <span>Folders</span>
              <strong>{prefix || "/"}</strong>
            </div>
            <div className="bucket-panel-actions">
              <button
                className="icon-button strong"
                type="button"
                onClick={() => void createFolder()}
                disabled={creatingFolder || loading || uploading || !activeBucket?.writable}
                title="Create folder"
              >
                {creatingFolder ? <Loader2 className="spin-icon" size={15} /> : <FolderPlus size={15} />}
              </button>
              <FolderGit2 size={17} />
            </div>
          </header>
          <div className="bucket-list">
            {prefix ? (
              <button className="bucket-row folder" type="button" onClick={() => setPrefix(parentR2Prefix(prefix))}>
                <ChevronRight size={14} />
                <span>..</span>
                <b>up</b>
              </button>
            ) : null}
            {folders.map((folder) => (
              <button className="bucket-row folder" key={folder.key} type="button" onClick={() => setPrefix(folder.key)}>
                <ChevronRight size={14} />
                <span>{folder.name}</span>
                <b>folder</b>
              </button>
            ))}
            {!loading && folders.length === 0 && !prefix ? <div className="empty-state">No folders</div> : null}
          </div>
        </section>

        <section className="bucket-panel object-panel">
          <header>
            <div>
              <span>{searchResults ? "Search results" : "Objects"}</span>
              <strong>{searchResults ? `${displayedObjects.length} results` : `${objects.length} files`}</strong>
              {searchMeta ? (
                <small>
                  {searchMeta.scanned} scanned
                  {searchMeta.includedText ? ` · ${searchMeta.contentScanned} content files` : ""}
                  {` · ${(searchMeta.durationMs / 1000).toFixed(1)}s`}
                  {searchMeta.timedOut ? " · time limit" : ""}
                  {searchMeta.contentErrors > 0 ? ` · ${searchMeta.contentErrors} issues` : ""}
                  {searchMeta.truncated ? " · more available" : ""}
                </small>
              ) : null}
            </div>
            <FileText size={17} />
          </header>
          <div className="bucket-list object-list">
            {(loading && objects.length === 0) || searching ? (
              <div className="preview-loading compact">
                <Loader2 size={18} />
                <span>{searching ? (searchIncludesText ? "Searching text/PDF" : "Searching buckets") : "Loading objects"}</span>
              </div>
            ) : null}
            {displayedObjects.map((object) => (
              <button
                className={selectedKey === bucketObjectSelectionId(object) ? "bucket-row object active" : "bucket-row object"}
                key={bucketObjectSelectionId(object)}
                type="button"
                onClick={() => setSelectedKey(bucketObjectSelectionId(object))}
              >
                <FileText size={14} />
                <span title={object.name}>{object.name}</span>
                <b>{formatBytes(object.size)}</b>
                <small title={[object.bucketName, object.key, object.snippet].filter(Boolean).join(" · ")}>
                  {object.bucketName ? `${object.bucketName} · ` : ""}
                  {object.key}
                  {object.snippet ? ` · ${object.snippet}` : ""}
                </small>
              </button>
            ))}
            {!loading && !searching && displayedObjects.length === 0 ? <div className="empty-state">{searchResults ? "No results" : "No objects"}</div> : null}
            {!searchResults && cursor ? (
              <button className="button ghost wide" type="button" onClick={() => void loadObjects(prefix, cursor, true)} disabled={loading}>
                Load more
              </button>
            ) : null}
          </div>
        </section>

        <BucketObjectPreview
          api={api}
          bucket={selectedObjectBucket}
          object={selectedObject}
          onDelete={deleteObject}
          onNotice={onNotice}
        />
      </div>
    </section>
  );
}

function updateBucketUploadEntry(
  state: BucketUploadState | null,
  id: string,
  patch: Partial<BucketUploadEntry>
): BucketUploadState | null {
  if (!state) return state;
  return {
    ...state,
    entries: state.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
  };
}

function bucketObjectSelectionId(object: BucketDisplayObjectRow): string {
  return object.bucketId ? `${object.bucketId}:${object.key}` : object.key;
}

function BucketUploadLog({ state }: { state: BucketUploadState }) {
  const done = state.completed;
  const percent = state.total > 0 ? Math.round((done / state.total) * 100) : 0;
  const hasErrors = state.entries.some((entry) => entry.status === "error");

  return (
    <section className={hasErrors ? "bucket-upload-log has-errors" : "bucket-upload-log"}>
      <header>
        <div>
          <span>{state.active ? "Uploading" : hasErrors ? "Upload completed with errors" : "Upload complete"}</span>
          <strong>
            {done}/{state.total} files
          </strong>
        </div>
        <b>{percent}%</b>
      </header>
      <div className="bucket-upload-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="bucket-upload-entries">
        {state.entries.map((entry) => (
          <div className={`bucket-upload-entry ${entry.status}`} key={entry.id}>
            {entry.status === "uploading" ? (
              <Loader2 size={14} />
            ) : entry.status === "done" ? (
              <CheckCircle2 size={14} />
            ) : entry.status === "error" ? (
              <AlertTriangle size={14} />
            ) : (
              <Circle size={14} />
            )}
            <div>
              <strong title={entry.name}>{entry.name}</strong>
              <span title={entry.key}>{entry.key}</span>
            </div>
            <small title={entry.message ?? formatBytes(entry.size)}>{entry.message ?? formatBytes(entry.size)}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function BucketObjectPreview({
  api,
  bucket,
  object,
  onDelete,
  onNotice
}: {
  api: ApiClient | null;
  bucket: BucketRow | null;
  object: BucketDisplayObjectRow | null;
  onDelete: (object: BucketDisplayObjectRow) => Promise<void>;
  onNotice: (message: string | null) => void;
}) {
  const [state, setState] = useState<{
    loading: boolean;
    downloading: boolean;
    error: string | null;
    kind: AttachmentPreviewKind;
    url: string | null;
    text: string | null;
    blob: Blob | null;
  }>({ loading: false, downloading: false, error: null, kind: "download", url: null, text: null, blob: null });
  const [textIndex, setTextIndex] = useState<{ text: string; source: string; updatedAt: string } | null>(null);
  const [previewExtracting, setPreviewExtracting] = useState(false);
  const officePreview = object ? isOfficePreviewCandidate(object.name, object.contentType) : false;

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    async function loadPreview() {
      if (!api || !bucket || !object) {
        setState({ loading: false, downloading: false, error: null, kind: "download", url: null, text: null, blob: null });
        return;
      }

      if (object.size > MAX_BUCKET_INLINE_PREVIEW_BYTES) {
        setState({ loading: false, downloading: false, error: null, kind: "download", url: null, text: null, blob: null });
        return;
      }

      setState({ loading: true, downloading: false, error: null, kind: "download", url: null, text: null, blob: null });
      try {
        const blob = await api.downloadBucketObject(bucket.id, object.key);
        objectUrl = URL.createObjectURL(blob);
        const kind = detectObjectPreviewKind(object.name, object.contentType || blob.type, blob);
        const text = kind === "text" ? await blob.text() : null;
        if (active) {
          setState({ loading: false, downloading: false, error: null, kind, url: objectUrl, text, blob });
        }
      } catch (error) {
        if (active) {
          const message = readError(error);
          setState({ loading: false, downloading: false, error: message, kind: "download", url: null, text: null, blob: null });
          onNotice(message);
        }
      }
    }

    void loadPreview();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, bucket, object, onNotice]);

  useEffect(() => {
    let active = true;

    async function loadTextIndex() {
      if (!api || !bucket || !object) {
        setTextIndex(null);
        return;
      }

      try {
        const data = await api.getBucketObjectTextIndex(bucket.id, object.key);
        if (active) {
          setTextIndex(data.index ? { text: data.index.text, source: data.index.source, updatedAt: data.index.updated_at } : null);
        }
      } catch {
        if (active) setTextIndex(null);
      }
    }

    void loadTextIndex();
    return () => {
      active = false;
    };
  }, [api, bucket, object]);

  async function generateTextPreview() {
    if (!api || !bucket || !object) return;
    setPreviewExtracting(true);
    try {
      const data = await api.generateBucketObjectTextPreview(bucket.id, object.key);
      if (data.index) {
        setTextIndex({ text: data.index.text, source: data.index.source, updatedAt: data.index.updated_at });
        onNotice(`Preview generated from ${data.index.source}`);
      } else {
        onNotice("Preview could not be generated");
      }
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setPreviewExtracting(false);
    }
  }

  async function downloadObject() {
    if (!api || !bucket || !object) return;
    if (state.blob) {
      saveBlob(state.blob, object.name);
      return;
    }

    setState((current) => ({ ...current, downloading: true }));
    try {
      const blob = await api.downloadBucketObject(bucket.id, object.key);
      saveBlob(blob, object.name);
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setState((current) => ({ ...current, downloading: false }));
    }
  }

  return (
    <section className="bucket-panel preview-panel">
      <header>
        <div>
          <span>Preview</span>
          <strong>{object?.name ?? "Select object"}</strong>
          {object ? (
            <small>
              {object.contentType} · {formatBytes(object.size)}
            </small>
          ) : null}
        </div>
        <div className="preview-actions">
          <button
            className="button ghost"
            type="button"
            disabled={!object || !api || !bucket || state.downloading}
            onClick={() => void downloadObject()}
          >
            {state.downloading ? <Loader2 size={15} /> : <Download size={15} />}
            {state.downloading ? "Downloading" : "Download"}
          </button>
          <button className="button danger" type="button" disabled={!object} onClick={() => object && void onDelete(object)}>
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      </header>

      <div className="bucket-preview-body">
        {object && textIndex ? (
          <div className="bucket-index-note">
            <FileText size={14} />
            Search index saved from {textIndex.source} at {formatDate(textIndex.updatedAt)}
          </div>
        ) : null}
        {!object ? (
          <div className="preview-fallback">
            <Server size={30} />
            <strong>Select an object</strong>
            <span>Preview, download, or delete R2 files here.</span>
          </div>
        ) : state.loading ? (
          <div className="preview-loading">
            <Loader2 size={22} />
            <span>Loading preview</span>
          </div>
        ) : state.error ? (
          <div className="preview-fallback warn">
            <AlertTriangle size={24} />
            <strong>{state.error}</strong>
          </div>
        ) : state.kind === "image" && state.url ? (
          <img className="image-preview" src={state.url} alt={object.name} />
        ) : state.kind === "pdf" && state.url ? (
          <iframe className="pdf-preview" src={pdfPreviewUrl(state.url)} title={object.name} />
        ) : officePreview ? (
          textIndex ? (
            <pre className="text-preview office-preview">{textIndex.text}</pre>
          ) : (
            <div className="preview-fallback">
              <FileText size={28} />
              <strong>{object.name}</strong>
              <span>Generate a searchable text preview for Word, Excel, or PowerPoint files.</span>
              <button className="button ghost" type="button" disabled={previewExtracting} onClick={() => void generateTextPreview()}>
                {previewExtracting ? <Loader2 size={15} /> : <FileText size={15} />}
                {previewExtracting ? "Generating preview" : "Generate preview"}
              </button>
            </div>
          )
        ) : state.kind === "text" ? (
          <pre className="text-preview">{state.text}</pre>
        ) : (
          <div className="preview-fallback">
            <FileText size={28} />
            <strong>{object.name}</strong>
            <span>
              {object.size > MAX_BUCKET_INLINE_PREVIEW_BYTES
                ? `Preview skipped over ${formatBytes(MAX_BUCKET_INLINE_PREVIEW_BYTES)}`
                : object.contentType || "No inline preview"}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function ThreadList({
  threads,
  total,
  hasMore,
  loadingMore,
  activeThreadId,
  folder,
  activeMailboxLabel,
  onSelect,
  onLoadMore
}: {
  threads: ThreadRow[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  activeThreadId: string | null;
  folder: FolderKey;
  activeMailboxLabel: string | null;
  onSelect: (threadId: string) => void;
  onLoadMore: () => void;
}) {
  const countLabel = total > threads.length ? `${threads.length} / ${total} loaded` : `${threads.length} threads`;

  return (
    <section className="thread-list">
      <div className="pane-head">
        <div>
          <span>{folder}</span>
          <strong>{activeMailboxLabel ?? "All mailboxes"}</strong>
          <small>{countLabel}</small>
        </div>
        <FolderGit2 size={16} />
      </div>
      <div className="thread-scroll">
        {threads.length === 0 ? (
          <div className="empty-state">No threads</div>
        ) : (
          threads.map((thread) => (
            <button
              key={`${thread.thread_id}-${thread.id}`}
              className={activeThreadId === thread.thread_id ? "thread-row active" : "thread-row"}
              type="button"
              onClick={() => onSelect(thread.thread_id)}
            >
              <span className={thread.unread_count > 0 ? "unread-dot on" : "unread-dot"} />
              <div className="thread-main">
                <div className="thread-title">
                  <strong>{thread.subject || "(no subject)"}</strong>
                  <time>{formatShortDate(thread.latest_at)}</time>
                </div>
                <div className="thread-meta">
                  <span>{thread.direction === "inbound" ? thread.from_address : thread.mailbox}</span>
                  <b>{thread.message_count}</b>
                </div>
                <p>{thread.snippet}</p>
              </div>
            </button>
          ))
        )}
        {hasMore ? (
          <button className="button ghost wide thread-load-more" type="button" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="spin-icon" size={15} /> : <ChevronDown size={15} />}
            {loadingMore ? "Loading more" : `Load more (${Math.max(total - threads.length, 0)} left)`}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function RichTextEditor({
  value,
  onChange,
  placeholder
}: {
  value: RichEditorValue;
  onChange: (value: RichEditorValue) => void;
  placeholder: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const [textColor, setTextColor] = useState("#111827");
  const [backgroundColor, setBackgroundColor] = useState("#fff3bf");
  const dialog = useAppDialog();

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    if (editor.innerHTML !== value.html) {
      editor.innerHTML = value.html;
    }
  }, [value.html]);

  function emitValue(clean = false) {
    const editor = editorRef.current;
    if (!editor) return;
    if (clean) {
      editor.innerHTML = sanitizeEmailHtml(autoLinkHtml(editor.innerHTML));
    }
    onChange({
      html: editor.innerHTML,
      text: editor.innerText.replace(/\u00a0/g, " ")
    });
  }

  function selectionBelongsToEditor(range: Range | null): boolean {
    const editor = editorRef.current;
    if (!editor || !range) return false;
    return editor.contains(range.commonAncestorContainer);
  }

  function saveSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0).cloneRange();
    if (selectionBelongsToEditor(range)) {
      selectionRef.current = range;
    }
  }

  function restoreSelection(): Range | null {
    const editor = editorRef.current;
    if (!editor) return null;
    editor.focus();
    const range = selectionRef.current;
    if (!range || !selectionBelongsToEditor(range)) return null;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return range;
  }

  function normalizeCurrentEditor() {
    const editor = editorRef.current;
    if (!editor) return;
    saveSelection();
    const caretOffset = caretTextOffset(editor);
    const text = editor.innerText.replace(/\u00a0/g, " ");
    editor.innerHTML = sanitizeEmailHtml(autoLinkHtml(editor.innerHTML || textToHtmlWithLinks(text)));
    if (caretOffset !== null) {
      restoreCaretTextOffset(editor, caretOffset);
    }
    emitValue();
    saveSelection();
  }

  function runCommand(command: string, commandValue?: string) {
    restoreSelection();
    document.execCommand(command, false, commandValue);
    emitValue();
    saveSelection();
  }

  function runBackgroundColor(color: string) {
    restoreSelection();
    if (!document.execCommand("hiliteColor", false, color)) {
      document.execCommand("backColor", false, color);
    }
    emitValue();
    saveSelection();
  }

  function keepEditorSelection(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    saveSelection();
  }

  async function addLink() {
    const selectedRange = restoreSelection()?.cloneRange() ?? selectionRef.current?.cloneRange() ?? null;
    const selectedText = selectedRange?.toString().trim() ?? "";
    const initialValue = selectedText && normalizeLinkHref(selectedText) ? selectedText : "https://";
    const input = await dialog.prompt({
      title: "Add link",
      message: "Paste a URL for the selected text.",
      defaultValue: initialValue,
      placeholder: "https://example.com",
      confirmLabel: "Add link"
    });
    const href = normalizeLinkHref(input ?? "");
    if (!href) return;
    applyLinkToSelection(href, selectedRange);
    emitValue(true);
    saveSelection();
  }

  function applyLinkToSelection(href: string, range: Range | null) {
    const editor = editorRef.current;
    if (!editor) return;
    const workingRange = range && selectionBelongsToEditor(range) ? range : document.createRange();
    if (!range || !selectionBelongsToEditor(range)) {
      workingRange.selectNodeContents(editor);
      workingRange.collapse(false);
    }

    const selectedLink = linkElementForRange(workingRange, editor);
    if (selectedLink) {
      selectedLink.href = href;
      selectedLink.target = "_blank";
      selectedLink.rel = "noopener noreferrer";
      if (!selectedLink.textContent?.trim()) selectedLink.textContent = href;
      placeCaretAfter(selectedLink);
      return;
    }

    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    if (workingRange.collapsed) {
      link.textContent = href.replace(/^mailto:/, "");
    } else {
      link.appendChild(workingRange.extractContents());
    }

    workingRange.insertNode(link);
    placeCaretAfter(link);
  }

  function placeCaretAfter(node: Node) {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    selectionRef.current = range.cloneRange();
  }

  function linkElementForRange(range: Range, editor: HTMLElement): HTMLAnchorElement | null {
    let node: Node | null = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }
    while (node && node !== editor) {
      if (node instanceof HTMLAnchorElement) return node;
      node = node.parentElement;
    }
    return null;
  }

  function caretTextOffset(editor: HTMLElement): number | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!range.collapsed || !editor.contains(range.commonAncestorContainer)) return null;
    const before = range.cloneRange();
    before.selectNodeContents(editor);
    before.setEnd(range.endContainer, range.endOffset);
    return before.toString().length;
  }

  function restoreCaretTextOffset(editor: HTMLElement, offset: number) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode() as Text | null;

    while (node) {
      if (remaining <= node.data.length) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        selectionRef.current = range.cloneRange();
        return;
      }
      remaining -= node.data.length;
      node = walker.nextNode() as Text | null;
    }

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    selectionRef.current = range.cloneRange();
  }

  return (
    <div className="rich-editor">
      <div className="rich-toolbar" aria-label="Message formatting" onMouseDown={saveSelection}>
        <button className="icon-button" type="button" onMouseDown={keepEditorSelection} onClick={() => runCommand("bold")} title="Bold">
          <Bold size={15} />
        </button>
        <button className="icon-button" type="button" onMouseDown={keepEditorSelection} onClick={() => runCommand("italic")} title="Italic">
          <Italic size={15} />
        </button>
        <button className="icon-button" type="button" onMouseDown={keepEditorSelection} onClick={() => runCommand("underline")} title="Underline">
          <Underline size={15} />
        </button>
        <label className="rich-color-button" title="Text color" onMouseDown={saveSelection}>
          <Type size={15} />
          <input
            type="color"
            value={textColor}
            onChange={(event) => {
              setTextColor(event.target.value);
              runCommand("foreColor", event.target.value);
            }}
          />
        </label>
        <label className="rich-color-button" title="Background color" onMouseDown={saveSelection}>
          <PaintBucket size={15} />
          <input
            type="color"
            value={backgroundColor}
            onChange={(event) => {
              setBackgroundColor(event.target.value);
              runBackgroundColor(event.target.value);
            }}
          />
        </label>
        <button className="icon-button" type="button" onMouseDown={keepEditorSelection} onClick={() => void addLink()} title="Add link">
          <Link size={15} />
        </button>
      </div>
      <div
        className="rich-editor-surface"
        contentEditable
        data-placeholder={placeholder}
        onBlur={() => emitValue(true)}
        onInput={() => {
          emitValue();
          saveSelection();
        }}
        onKeyUp={(event) => {
          saveSelection();
          if (event.key === " " || event.key === "Enter") {
            normalizeCurrentEditor();
          }
        }}
        onMouseUp={saveSelection}
        ref={editorRef}
        role="textbox"
        spellCheck
        suppressContentEditableWarning
      />
    </div>
  );
}

function ThreadDetail({
  api,
  thread,
  mailboxes,
  externalAccounts,
  folder,
  onSent,
  onThreadAction
}: {
  api: ApiClient | null;
  thread: ThreadPayload | null;
  mailboxes: MailboxRow[];
  externalAccounts: ExternalAccountRow[];
  folder: FolderKey;
  onSent: () => Promise<void>;
  onThreadAction: (action: "archive" | "unarchive" | "delete") => Promise<void>;
}) {
  const [replyDraft, setReplyDraft] = useState<RichEditorValue>({ html: "", text: "" });
  const [from, setFrom] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<AttachmentDraft[]>([]);
  const [replyAttachmentsLoading, setReplyAttachmentsLoading] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRow | null>(null);
  const dialog = useAppDialog();
  const firstMessage = thread?.messages[0] ?? null;
  const lastInbound = [...(thread?.messages ?? [])].reverse().find((message) => message.direction === "inbound");
  const fromOptions = useMemo(() => sendableFromOptions(mailboxes, externalAccounts), [externalAccounts, mailboxes]);
  const preferredFrom = firstMessage?.mailbox ?? fromOptions[0]?.value ?? "";
  const isArchived = Boolean(firstMessage?.archived_at);

  useEffect(() => {
    if (preferredFrom && fromOptions.some((option) => option.value === preferredFrom)) {
      setFrom(preferredFrom);
    } else if (!from || !fromOptions.some((option) => option.value === from)) {
      setFrom(fromOptions[0]?.value ?? "");
    }
  }, [firstMessage?.thread_id, from, preferredFrom, fromOptions]);

  useEffect(() => {
    setReplyDraft({ html: "", text: "" });
    setReplyAttachments([]);
    setReplyAttachmentsLoading(false);
    setReplyError(null);
    setPreviewAttachment(null);
  }, [firstMessage?.thread_id]);

  if (!thread || !firstMessage) {
    return (
      <section className="thread-detail empty-detail">
        <TerminalSquare size={28} />
        <span>Select a thread</span>
      </section>
    );
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
	      !api ||
	      replyAttachmentsLoading ||
	      (!replyDraft.text.trim() && replyAttachments.length === 0) ||
      !from ||
      !lastInbound ||
      !firstMessage
    ) {
      return;
    }
    setReplyError(null);
    setBusyAction("reply");
    try {
	      await api.send({
	        from,
	        to: lastInbound.from_address,
	        subject: firstMessage.subject.startsWith("Re:") ? firstMessage.subject : `Re: ${firstMessage.subject}`,
	        text: replyDraft.text,
	        html: prepareOutgoingHtml(replyDraft),
	        replyToThreadId: firstMessage.thread_id,
	        attachments: replyAttachments
	      });
	      setReplyDraft({ html: "", text: "" });
      setReplyAttachments([]);
      await onSent();
    } catch (error) {
      setReplyError(readError(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function patchArchive() {
    if (!api || !firstMessage) return;
    const action = isArchived ? "unarchive" : "archive";
    setBusyAction(action);
    try {
      await api.patchThread(firstMessage.thread_id, action);
      await onThreadAction(action);
    } catch (error) {
      setReplyError(readError(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteCurrentThread() {
    if (!api || !firstMessage) return;
    const confirmed = await dialog.confirm({
      title: "Delete thread",
      message: "Delete this thread and its stored message files permanently? This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!confirmed) return;

    setReplyError(null);
    setBusyAction("delete");
    try {
      await api.deleteThread(firstMessage.thread_id);
      await onThreadAction("delete");
    } catch (error) {
      setReplyError(readError(error));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="thread-detail">
      <div className="detail-head">
        <div>
          <span>{firstMessage.mailbox}</span>
          <h2>{firstMessage.subject || "(no subject)"}</h2>
        </div>
        <div className="detail-actions">
          <button className="button ghost" type="button" onClick={() => void patchArchive()} disabled={busyAction !== null}>
            {busyAction === "archive" || busyAction === "unarchive" ? <Loader2 className="spin-icon" size={16} /> : <Archive size={16} />}
            {busyAction === "archive" ? "Archiving" : busyAction === "unarchive" ? "Restoring" : isArchived ? "Unarchive" : "Archive"}
          </button>
          <button className="button danger" type="button" onClick={() => void deleteCurrentThread()} disabled={busyAction !== null}>
            {busyAction === "delete" ? <Loader2 className="spin-icon" size={16} /> : <Trash2 size={16} />}
            {busyAction === "delete" ? "Deleting" : "Delete"}
          </button>
        </div>
      </div>

      <div className="message-stack">
        {thread.messages.map((message) => (
          <article className={message.direction === "outbound" ? "message outgoing" : "message"} key={message.id}>
            <header>
              <div>
                <strong>{message.direction === "outbound" ? message.from_address : message.from_name ?? message.from_address}</strong>
                <span>{message.direction}</span>
              </div>
              <time>{formatDate(message.created_at)}</time>
            </header>
            {message.html_body ? (
              <div
                className="message-html"
                dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(message.html_body) }}
              />
            ) : (
              <div
                className="message-text"
                dangerouslySetInnerHTML={{ __html: textToHtmlWithLinks(message.text_body || message.snippet || "No text body") }}
              />
            )}
            {thread.attachments.filter((attachment) => attachment.message_id === message.id).length > 0 ? (
              <div className="attachment-strip">
                {thread.attachments
                  .filter((attachment) => attachment.message_id === message.id)
                  .map((attachment) => (
                    <button
                      className="attachment-pill"
                      key={attachment.id}
                      type="button"
                      onClick={() => setPreviewAttachment(attachment)}
                    >
                      <Eye size={13} />
                      {attachment.filename}
                    </button>
                  ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <form className="reply-box" onSubmit={submitReply}>
        <div className="reply-tools">
          <label>
            From
            <CustomSelect
              value={from}
              onChange={setFrom}
              options={fromOptions}
            />
          </label>
          <span>
            <Reply size={14} />
            {lastInbound?.from_address ?? "recipient"}
          </span>
        </div>
        {replyError ? (
          <div className="login-error compact">
            <AlertTriangle size={15} />
            <span>{replyError}</span>
          </div>
        ) : null}
        <RichTextEditor value={replyDraft} onChange={setReplyDraft} placeholder="Reply" />
        <AttachmentPicker
          value={replyAttachments}
          onChange={setReplyAttachments}
          onLoadingChange={setReplyAttachmentsLoading}
          disabled={busyAction !== null}
        />
        <button
          className="button primary send-button"
          type="submit"
          disabled={
            busyAction !== null ||
            replyAttachmentsLoading ||
            (!replyDraft.text.trim() && replyAttachments.length === 0) ||
            !from
          }
        >
          <SendHorizontal size={16} />
          {replyAttachmentsLoading ? "Loading attachments" : busyAction === "reply" ? "Sending" : "Send reply"}
        </button>
      </form>
      {previewAttachment ? (
        <AttachmentPreviewDialog
          api={api}
          attachment={previewAttachment}
          onClose={() => setPreviewAttachment(null)}
        />
      ) : null}
    </section>
  );
}

function ComposeDialog({
  api,
  mailboxes,
  externalAccounts,
  contacts,
  onClose,
  onSent,
  initialFrom
}: {
  api: ApiClient | null;
  mailboxes: MailboxRow[];
  externalAccounts: ExternalAccountRow[];
  contacts: ContactRow[];
  onClose: () => void;
  onSent: () => Promise<void>;
  initialFrom: string | null;
}) {
  const fromOptions = useMemo(() => sendableFromOptions(mailboxes, externalAccounts), [externalAccounts, mailboxes]);
  const initialSendableFrom = fromOptions.some((option) => option.value === initialFrom)
    ? initialFrom ?? ""
    : fromOptions[0]?.value ?? "";
  const [from, setFrom] = useState(initialSendableFrom);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [draft, setDraft] = useState<RichEditorValue>({ html: "", text: "" });
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toFocused, setToFocused] = useState(false);
  const contactQuery = currentAddressNeedle(to);
  const contactSuggestions = useMemo(
    () =>
      contactQuery
        ? contacts
            .filter((contact) => contactMatchesQuery(contact, contactQuery))
            .filter((contact) => !addressListContains(to, contact.email))
            .slice(0, 6)
        : [],
    [contactQuery, contacts, to]
  );

  useEffect(() => {
    if (!from || !fromOptions.some((option) => option.value === from)) {
      setFrom(fromOptions[0]?.value ?? "");
    }
  }, [from, fromOptions]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || attachmentsLoading || !from || !to.trim() || !subject.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api.send({ from, to, subject, text: draft.text, html: prepareOutgoingHtml(draft), attachments });
      await onSent();
    } catch (sendError) {
      setError(readError(sendError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true">
      <form className="compose-modal" onSubmit={submit}>
        <header>
          <strong>Compose</strong>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </header>
        {error ? (
          <div className="login-error">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        ) : null}
        <label>
          From
          <CustomSelect
            value={from}
            onChange={setFrom}
            options={fromOptions}
          />
        </label>
        <label>
          To
          <div className="to-field">
            <input
              value={to}
              onBlur={() => window.setTimeout(() => setToFocused(false), 120)}
              onChange={(event) => setTo(event.target.value)}
              onFocus={() => setToFocused(true)}
              placeholder="ops@example.com"
            />
            {toFocused && contactSuggestions.length > 0 ? (
              <div className="contact-suggestions" role="listbox">
                {contactSuggestions.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setTo((current) => replaceCurrentAddressToken(current, contact.email));
                      setToFocused(false);
                    }}
                  >
                    <Users size={14} />
                    <span>
                      <strong>{contact.name || contact.email}</strong>
                      <small>{contact.email}</small>
                    </span>
                    {contact.phone || contact.company ? <b>{contact.phone ?? contact.company}</b> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </label>
        <label>
          Subject
          <input value={subject} onChange={(event) => setSubject(event.target.value)} />
        </label>
        <RichTextEditor value={draft} onChange={setDraft} placeholder="Message" />
        <AttachmentPicker
          value={attachments}
          onChange={setAttachments}
          onLoadingChange={setAttachmentsLoading}
          disabled={busy}
        />
        <button
          className="button primary wide"
          type="submit"
          disabled={busy || attachmentsLoading || !from || !to.trim() || !subject.trim()}
        >
          <SendHorizontal size={16} />
          {attachmentsLoading ? "Loading attachments" : busy ? "Sending" : "Send"}
        </button>
      </form>
    </div>
  );
}

type AttachmentPreviewKind = "image" | "pdf" | "text" | "office" | "download";

function AttachmentPreviewDialog({
  api,
  attachment,
  onClose
}: {
  api: ApiClient | null;
  attachment: AttachmentRow;
  onClose: () => void;
}) {
  const [state, setState] = useState<{
    loading: boolean;
    extracting: boolean;
    error: string | null;
    kind: AttachmentPreviewKind;
    url: string | null;
    text: string | null;
    generatedText: string | null;
    generatedSource: string | null;
    blob: Blob | null;
  }>({
    loading: true,
    extracting: false,
    error: null,
    kind: "download",
    url: null,
    text: null,
    generatedText: null,
    generatedSource: null,
    blob: null
  });

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    async function loadPreview() {
      if (!api) {
        setState((current) => ({ ...current, loading: false, error: "Preview is unavailable" }));
        return;
      }

      setState({
        loading: true,
        extracting: false,
        error: null,
        kind: "download",
        url: null,
        text: null,
        generatedText: null,
        generatedSource: null,
        blob: null
      });

      try {
        const blob = await api.downloadAttachment(attachment.id);
        objectUrl = URL.createObjectURL(blob);
        const kind = detectAttachmentPreviewKind(attachment, blob);
        const text = kind === "text" ? await blob.text() : null;

        if (active) {
          setState({ loading: false, extracting: false, error: null, kind, url: objectUrl, text, generatedText: null, generatedSource: null, blob });
        }
      } catch (error) {
        if (active) {
          setState({
            loading: false,
            extracting: false,
            error: readError(error),
            kind: "download",
            url: null,
            text: null,
            generatedText: null,
            generatedSource: null,
            blob: null
          });
        }
      }
    }

    void loadPreview();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, attachment]);

  async function generateAttachmentPreview() {
    if (!api) return;
    setState((current) => ({ ...current, extracting: true, error: null }));
    try {
      const data = await api.generateAttachmentTextPreview(attachment.id);
      setState((current) => ({
        ...current,
        extracting: false,
        generatedText: data.preview.text,
        generatedSource: data.preview.source
      }));
    } catch (error) {
      setState((current) => ({ ...current, extracting: false, error: readError(error) }));
    }
  }

  return (
    <div className="modal-scrim preview-scrim" role="dialog" aria-modal="true">
      <section className="attachment-preview-modal">
        <header>
          <div>
            <span>Attachment preview</span>
            <strong>{attachment.filename}</strong>
            <small>
              {attachment.content_type || "application/octet-stream"} · {formatBytes(attachment.size)}
            </small>
          </div>
          <div className="preview-actions">
            <button
              className="button ghost"
              type="button"
              disabled={!state.blob}
              onClick={() => {
                if (state.blob) saveBlob(state.blob, attachment.filename);
              }}
            >
              <Download size={15} />
              Download
            </button>
            <button className="icon-button" type="button" onClick={onClose} title="Close">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="attachment-preview-body">
          {state.loading ? (
            <div className="preview-loading">
              <Loader2 size={22} />
              <span>Loading preview</span>
            </div>
          ) : state.error ? (
            <div className="preview-fallback warn">
              <AlertTriangle size={24} />
              <strong>{state.error}</strong>
            </div>
          ) : state.kind === "image" && state.url ? (
            <img className="image-preview" src={state.url} alt={attachment.filename} />
          ) : state.kind === "pdf" && state.url ? (
            <iframe className="pdf-preview" src={state.url} title={attachment.filename} />
          ) : state.kind === "office" ? (
            state.generatedText ? (
              <div className="office-preview-stack">
                <div className="bucket-index-note">
                  <FileText size={14} />
                  Preview generated from {state.generatedSource ?? "document extraction"}
                </div>
                <pre className="text-preview office-preview">{state.generatedText}</pre>
              </div>
            ) : (
              <div className="preview-fallback">
                <FileText size={28} />
                <strong>{attachment.filename}</strong>
                <span>Generate a readable text preview for this Office attachment.</span>
                <button className="button ghost" type="button" disabled={state.extracting} onClick={() => void generateAttachmentPreview()}>
                  {state.extracting ? <Loader2 size={15} /> : <FileText size={15} />}
                  {state.extracting ? "Generating preview" : "Generate preview"}
                </button>
              </div>
            )
          ) : state.kind === "text" ? (
            <pre className="text-preview">{state.text}</pre>
          ) : (
            <div className="preview-fallback">
              <FileText size={28} />
              <strong>{attachment.filename}</strong>
              <span>{attachment.content_type || "No inline preview"}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AttachmentPicker({
  value,
  onChange,
  onLoadingChange,
  disabled = false
}: {
  value: AttachmentDraft[];
  onChange: (attachments: AttachmentDraft[]) => void;
  onLoadingChange?: (loading: boolean) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setLoading(true);

    try {
      const next = [...value];
      for (const file of Array.from(files)) {
        const totalSize = next.reduce((sum, item) => sum + item.size, 0) + file.size;
        if (file.size > MAX_CLIENT_ATTACHMENT_BYTES) {
          throw new Error(`${file.name} is too large`);
        }
        if (totalSize > MAX_CLIENT_TOTAL_ATTACHMENT_BYTES) {
          throw new Error("Attachments are too large");
        }
        next.push({
          filename: file.name || "attachment",
          contentType: file.type || "application/octet-stream",
          contentBase64: await fileToBase64(file),
          size: file.size
        });
      }
      onChange(next);
    } catch (fileError) {
      setError(readError(fileError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="attachment-picker">
      <label className={loading ? "attachment-add is-loading" : "attachment-add"}>
        {loading ? <Loader2 size={15} /> : <Paperclip size={15} />}
        <span>{loading ? "Loading attachments" : "Add attachment"}</span>
        <input
          type="file"
          multiple
          disabled={disabled || loading}
          onChange={(event) => {
            void addFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {value.length > 0 ? (
        <div className="attachment-drafts">
          {value.map((attachment, index) => (
            <span key={`${attachment.filename}-${index}`}>
              <Paperclip size={13} />
              {attachment.filename}
              <b>{formatBytes(attachment.size)}</b>
              <button
                className="icon-button tiny"
                type="button"
                onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                disabled={disabled || loading}
                title="Remove attachment"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? <small>{error}</small> : null}
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "status-pill ok" : "status-pill"}>
      {ok ? <CheckCircle2 size={13} /> : <Circle size={13} />}
      {label}
    </span>
  );
}

function RuleCapabilityItem({
  icon: Icon,
  title,
  text,
  tone
}: {
  icon: typeof Mail;
  title: string;
  text: string;
  tone: "ok" | "warn" | "info";
}) {
  return (
    <div className={`routing-summary-item ${tone}`}>
      <Icon size={16} />
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}

function describeSending(domain: DomainRow): { title: string; text: string; tone: "ok" | "warn" | "info" } {
  if (domain.sending_enabled === 1) {
    return {
      title: `Can send from @${domain.domain}`,
      text: "Outgoing mail is allowed for enabled mailbox addresses on this verified sending domain.",
      tone: "ok"
    };
  }

  return {
    title: "Cannot send yet",
    text: "Enable Cloudflare Email Sending for this domain, then run Sync.",
    tone: "warn"
  };
}

function describeReceiving(
  domain: DomainRow,
  routedAddresses: string[],
  catchAllActive: boolean
): { title: string; text: string; tone: "ok" | "warn" | "info" } {
  if (catchAllActive) {
    return {
      title: `Receives every address at @${domain.domain}`,
      text: "Catch-all routes unknown addresses and existing mailboxes to this Worker.",
      tone: "ok"
    };
  }

  if (routedAddresses.length > 0) {
    return {
      title: `Receives ${formatAddressList(routedAddresses)}`,
      text:
        domain.routing_enabled === 1
          ? `Only routed addresses arrive. Other @${domain.domain} addresses need catch-all or their own Worker route.`
          : "A mailbox Worker route is active. Cloudflare domain status was not reported by sync, but routed addresses can receive mail.",
      tone: "ok"
    };
  }

  if (domain.routing_enabled !== 1) {
    return {
      title: "Cannot receive yet",
      text: "Email Routing is not active for this domain. Enable routing in Cloudflare, then run Sync.",
      tone: "warn"
    };
  }

  return {
    title: "Routing enabled, no address route yet",
    text: "Create a mailbox with Worker rule enabled, route an existing mailbox, or enable catch-all.",
    tone: "warn"
  };
}

function formatAddressList(addresses: string[]): string {
  if (addresses.length <= 2) return addresses.join(" and ");
  return `${addresses.slice(0, 2).join(", ")} and ${addresses.length - 2} more`;
}

function parseAuditMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function auditLogStatus(
  log: AuditLogRow,
  metadata: Record<string, unknown>
): { label: string; tone: "ok" | "error" | "warn"; icon: typeof CheckCircle2 } {
  const status = typeof metadata.status === "number" ? metadata.status : null;
  const lowerAction = log.action.toLowerCase();
  if (lowerAction.includes("failed") || lowerAction.includes("error") || (status !== null && status >= 400)) {
    return { label: "Error", tone: "error", icon: AlertTriangle };
  }
  if (lowerAction.includes("queued")) {
    return { label: "Queued", tone: "warn", icon: Loader2 };
  }
  return { label: "Success", tone: "ok", icon: CheckCircle2 };
}

function humanizeAuditAction(action: string): string {
  return action
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function summarizeAuditMetadata(metadata: Record<string, unknown>): string {
  const hiddenWords = ["password", "token", "secret", "contentbase64", "html", "text"];
  const entries = Object.entries(metadata)
    .filter(([key]) => !hiddenWords.some((word) => key.toLowerCase().includes(word)))
    .slice(0, 8);

  if (entries.length === 0) return "No details";

  return entries
    .map(([key, value]) => `${humanizeAuditAction(key)}: ${formatAuditValue(value)}`)
    .join(" | ");
}

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.map(formatAuditValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value).slice(0, 180);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value).slice(0, 220);
}

function logsToCsv(rows: AuditLogRow[]): string {
  const header = ["id", "created_at", "status", "action", "actor", "target", "metadata_json"];
  const body = rows.map((row) => {
    const metadata = parseAuditMetadata(row.metadata_json);
    const status = auditLogStatus(row, metadata).label;
    return [row.id, row.created_at, status, row.action, row.actor, row.target ?? "", row.metadata_json]
      .map(csvCell)
      .join(",");
  });
  return [header.join(","), ...body].join("\n");
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadTextFile(filename: string, body: string, type: string): void {
  const blob = new Blob([body], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit"
  }).format(new Date(value));
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isAuthError(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

function currentAddressNeedle(value: string): string {
  const token = value.split(/[,\n;]/).pop() ?? "";
  return token.replace(/[<>"']/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function addressListContains(value: string, email: string): boolean {
  const normalized = email.toLowerCase();
  return value
    .split(/[,\n;]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

function replaceCurrentAddressToken(value: string, email: string): string {
  if (addressListContains(value, email)) {
    return value;
  }

  const lastSeparator = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"), value.lastIndexOf("\n"));
  const prefix = lastSeparator >= 0 ? `${value.slice(0, lastSeparator + 1).trimEnd()} ` : "";
  return `${prefix}${email}, `;
}

function contactMatchesQuery(contact: ContactRow, query: string): boolean {
  const haystack = [contact.email, contact.name, contact.company, contact.phone, contact.tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",").pop() ?? "" : result);
    };
    reader.onerror = () => reject(new Error("File could not be read"));
    reader.readAsDataURL(file);
  });
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function detectAttachmentPreviewKind(attachment: AttachmentRow, blob: Blob): AttachmentPreviewKind {
  return detectObjectPreviewKind(attachment.filename, attachment.content_type || blob.type, blob);
}

function detectObjectPreviewKind(filenameInput: string, contentTypeInput: string, blob: Blob): AttachmentPreviewKind {
  const filename = filenameInput.toLowerCase();
  const contentType = (contentTypeInput || blob.type || "").toLowerCase();
  const textExtensions = [".txt", ".md", ".csv", ".json", ".log", ".xml", ".html", ".css", ".js", ".ts", ".tsx", ".yml", ".yaml"];

  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  if (isOfficePreviewCandidate(filename, contentType)) return "office";
  if (blob.size <= 2 * 1024 * 1024 && (contentType.startsWith("text/") || textExtensions.some((ext) => filename.endsWith(ext)))) {
    return "text";
  }

  return "download";
}

function pdfPreviewUrl(url: string): string {
  const separator = url.includes("#") ? "&" : "#";
  return `${url}${separator}navpanes=0&view=FitH`;
}

function isOfficePreviewCandidate(filenameInput: string, contentTypeInput: string): boolean {
  const filename = filenameInput.toLowerCase();
  const contentType = contentTypeInput.toLowerCase();
  const officeExtensions = [".doc", ".docx", ".word", ".wordx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp"];
  return (
    officeExtensions.some((extension) => filename.endsWith(extension)) ||
    contentType.includes("officedocument") ||
    contentType.includes("msword") ||
    contentType.includes("ms-excel") ||
    contentType.includes("ms-powerpoint") ||
    contentType.includes("spreadsheet") ||
    contentType.includes("presentation") ||
    contentType.includes("opendocument")
  );
}

function buildR2UploadKey(prefix: string, filename: string): string {
  const safeName = filename.replace(/[\\\u0000-\u001f\u007f]/g, "_").replace(/^\/+/, "").trim() || "upload";
  return `${prefix}${safeName}`.replace(/^\/+/, "");
}

function normalizeNotesPrefix(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  return normalized ? `${normalized}/` : "";
}

function normalizeNoteFilename(value: string): string {
  const normalized = value.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim() || defaultNoteFilename();
  return /\.[a-z0-9]{1,8}$/i.test(normalized) ? normalized : `${normalized}.txt`;
}

function defaultNoteFilename(): string {
  const now = new Date();
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join("-");
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds()), pad(now.getMilliseconds(), 3)].join("-");
  return `note-${stamp}_${time}.txt`;
}

function prefixParts(prefix: string): { name: string; prefix: string }[] {
  const parts = prefix.split("/").filter(Boolean);
  return parts.map((name, index) => ({
    name,
    prefix: `${parts.slice(0, index + 1).join("/")}/`
  }));
}

function parentR2Prefix(prefix: string): string {
  const parts = prefix.split("/").filter(Boolean);
  return parts.length <= 1 ? "" : `${parts.slice(0, -1).join("/")}/`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function prepareOutgoingHtml(value: RichEditorValue): string | null {
  if (!value.text.trim()) return null;
  return sanitizeEmailHtml(autoLinkHtml(value.html || textToHtmlWithLinks(value.text))).trim() || textToHtmlWithLinks(value.text);
}

function htmlToPlainText(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = sanitizeEmailHtml(html);
  return container.innerText.replace(/\u00a0/g, " ").trim();
}

function textToHtmlWithLinks(text: string): string {
  const container = document.createElement("div");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(document.createElement("br"));
    container.appendChild(document.createTextNode(line));
  });
  linkifyTextNodes(container);
  return container.innerHTML;
}

function autoLinkHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  linkifyTextNodes(template.content);
  return template.innerHTML;
}

function sanitizeEmailHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeHtmlNode(template.content);
  return template.innerHTML;
}

function sanitizeHtmlNode(root: Node) {
  const allowedTags = new Set(["A", "B", "BLOCKQUOTE", "BR", "CODE", "DIV", "EM", "FONT", "I", "LI", "OL", "P", "PRE", "SPAN", "STRONG", "U", "UL"]);
  const blockedTags = new Set(["EMBED", "IFRAME", "LINK", "META", "OBJECT", "SCRIPT", "STYLE"]);

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }

    const element = child as HTMLElement;
    const tagName = element.tagName.toUpperCase();
    if (blockedTags.has(tagName)) {
      element.remove();
      continue;
    }

    sanitizeHtmlNode(element);

    if (!allowedTags.has(tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    const href = tagName === "A" ? normalizeLinkHref(element.getAttribute("href") ?? "") : null;
    const colorAttribute = tagName === "FONT" ? element.getAttribute("color") : null;
    const cleanStyle = sanitizeInlineStyle(element.getAttribute("style"), colorAttribute);

    for (const attribute of Array.from(element.attributes)) {
      element.removeAttribute(attribute.name);
    }

    if (tagName === "A" && href) {
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
    if (cleanStyle) {
      element.setAttribute("style", cleanStyle);
    }
  }
}

function sanitizeInlineStyle(style: string | null, colorAttribute: string | null): string {
  const clean: string[] = [];
  const allowed = new Set(["background-color", "color", "font-style", "font-weight", "text-decoration"]);
  for (const part of (style ?? "").split(";")) {
    const [rawProperty, ...rawValue] = part.split(":");
    const property = rawProperty?.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (!property || !value || !allowed.has(property) || /url|expression|javascript|data:/i.test(value)) continue;
    if ((property === "color" || property === "background-color") && !isSafeCssColor(value)) continue;
    if (property === "font-style" && !/^(normal|italic|oblique)$/i.test(value)) continue;
    if (property === "font-weight" && !/^(normal|bold|[1-9]00)$/i.test(value)) continue;
    if (property === "text-decoration" && !/^(none|underline|line-through)$/i.test(value)) continue;
    clean.push(`${property}: ${value}`);
  }

  if (colorAttribute && isSafeCssColor(colorAttribute) && !clean.some((item) => item.startsWith("color:"))) {
    clean.push(`color: ${colorAttribute}`);
  }

  return clean.join("; ");
}

function isSafeCssColor(value: string): boolean {
  const color = value.trim();
  return (
    color.length <= 48 &&
    (/^#[0-9a-f]{3,8}$/i.test(color) ||
      /^(rgb|rgba|hsl|hsla)\([0-9%.,\s]+\)$/i.test(color) ||
      /^[a-z]+$/i.test(color))
  );
}

function linkifyTextNodes(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent = node.parentElement;
      while (parent) {
        if (parent.tagName.toUpperCase() === "A") return NodeFilter.FILTER_REJECT;
        parent = parent.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }
  nodes.forEach(linkifyTextNode);
}

function linkifyTextNode(node: Text) {
  const value = node.nodeValue ?? "";
  const pattern = /((?:https?:\/\/|www\.)[^\s<]+|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
  const matches = [...value.matchAll(pattern)];
  if (matches.length === 0) return;

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    const raw = match[0];
    if (start > cursor) {
      fragment.appendChild(document.createTextNode(value.slice(cursor, start)));
    }
    const trailing = raw.match(/[),.!?;:]+$/)?.[0] ?? "";
    const core = trailing ? raw.slice(0, -trailing.length) : raw;
    const href = normalizeLinkHref(core);
    if (href) {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = core;
      fragment.appendChild(link);
    } else {
      fragment.appendChild(document.createTextNode(core));
    }
    if (trailing) {
      fragment.appendChild(document.createTextNode(trailing));
    }
    cursor = start + raw.length;
  }
  if (cursor < value.length) {
    fragment.appendChild(document.createTextNode(value.slice(cursor)));
  }
  node.replaceWith(fragment);
}

function normalizeLinkHref(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw)) {
    return `mailto:${raw}`;
  }
  const withProtocol = raw.startsWith("www.") ? `https://${raw}` : raw;
  try {
    const url = new URL(withProtocol);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function parseContactsFromText(text: string, filename: string): ContactParseResult {
  const lowerName = filename.toLowerCase();
  const contacts = lowerName.endsWith(".vcf") ? parseVcards(text) : parseDelimitedContacts(text);
  const unique = new Map<string, ContactInput>();
  let duplicateEmails = 0;

  for (const contact of contacts.contacts) {
    const email = contact.email?.trim().toLowerCase();
    if (email && !unique.has(email)) {
      unique.set(email, { ...contact, email });
    } else if (email) {
      duplicateEmails += 1;
    }
  }

  return {
    contacts: [...unique.values()].slice(0, 1000),
    scanned: contacts.scanned,
    duplicateEmails,
    ignoredRows: contacts.ignoredRows
  };
}

function parseVcards(text: string): { contacts: ContactInput[]; scanned: number; ignoredRows: number } {
  const contacts: ContactInput[] = [];
  let scanned = 0;
  let ignoredRows = 0;
  for (const block of text.split(/BEGIN:VCARD/i)) {
    if (!block.trim()) continue;
    scanned += 1;
    const email = block.match(/^EMAIL[^:]*:(.+)$/im)?.[1]?.trim();
    if (email) {
      contacts.push({
        email,
        name: block.match(/^FN[^:]*:(.+)$/im)?.[1]?.trim() ?? null,
        company: block.match(/^ORG[^:]*:(.+)$/im)?.[1]?.trim() ?? null,
        phone: block.match(/^TEL[^:]*:(.+)$/im)?.[1]?.trim() ?? null,
        tags: "vcard",
        notes: null
      });
    } else {
      ignoredRows += 1;
    }
  }
  return { contacts, scanned, ignoredRows };
}

function parseDelimitedContacts(text: string): { contacts: ContactInput[]; scanned: number; ignoredRows: number } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { contacts: [], scanned: 0, ignoredRows: 0 };

  const header = parseCsvLine(lines[0]).map((item) => item.toLowerCase());
  const emailColumn = header.findIndex((item) => ["email", "e-mail", "mail"].includes(item));

  if (emailColumn >= 0) {
    let ignoredRows = 0;
    const contacts = lines.slice(1).flatMap((line) => {
      const cells = parseCsvLine(line);
      const email = cells[emailColumn]?.trim();
      if (!email) {
        ignoredRows += 1;
        return [];
      }
      const firstName = cellByHeader(cells, header, ["first name", "firstname", "given name"]) ?? "";
      const lastName = cellByHeader(cells, header, ["last name", "lastname", "surname", "family name"]) ?? "";
      const combinedName = [firstName, lastName].filter(Boolean).join(" ").trim();
      return [
        {
          email,
          name: cellByHeader(cells, header, ["name", "full name", "display name"]) ?? (combinedName || null),
          company: cellByHeader(cells, header, ["company", "organization", "org"]),
          phone: cellByHeader(cells, header, ["phone", "phone number", "mobile", "mobile phone", "tel", "telephone"]),
          tags: cellByHeader(cells, header, ["tags", "tag", "groups"]),
          notes: cellByHeader(cells, header, ["notes", "note"])
        }
      ];
    });
    return { contacts, scanned: Math.max(0, lines.length - 1), ignoredRows };
  }

  const contacts: ContactInput[] = [];
  let ignoredRows = 0;
  const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
  for (const line of lines) {
    let foundInLine = false;
    for (const match of line.matchAll(emailPattern)) {
      const email = match[0];
      const name = line
        .slice(0, match.index)
        .replace(/[<,;"']/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      contacts.push({ email, name: name || null, phone: findPhoneInText(line) });
      foundInLine = true;
    }
    if (!foundInLine) {
      ignoredRows += 1;
    }
  }
  return { contacts, scanned: lines.length, ignoredRows };
}

function findPhoneInText(text: string): string | null {
  return text.match(/\+?\d[\d\s().-]{6,}\d/)?.[0]?.trim() ?? null;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if ((char === "," || char === ";") && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function cellByHeader(cells: string[], header: string[], names: string[]): string | null {
  const index = header.findIndex((item) => names.includes(item));
  return index >= 0 && cells[index]?.trim() ? cells[index].trim() : null;
}
