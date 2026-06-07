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
  Inbox,
  Italic,
  Loader2,
  Link,
  Mail,
  Palette,
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
  requestPasswordReset,
  setupStatus
} from "./api";
import {
  AttachmentRow,
  BootstrapPayload,
  BucketFolderRow,
  BucketObjectRow,
  BucketRow,
  BucketSearchResultRow,
  ContactRow,
  DomainRow,
  ExternalAccountRow,
  FolderKey,
  MailboxRow,
  MailboxSignatureRow,
  RuntimeRequirement,
  SetupStatusPayload,
  ThreadPayload,
  ThreadRow
} from "./types";

const PASSWORD_KEY = "omnidock.password";
const PALETTE_KEY = "omnidock.palette";
const DEFAULT_MAILBOX_KEY = "omnidock.defaultMailbox";
const REFRESH_INTERVAL_KEY = "omnidock.refreshIntervalSeconds";
const DEFAULT_REFRESH_INTERVAL_SECONDS = 10;

const folders: { key: FolderKey; label: string; icon: typeof Inbox }[] = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "sent", label: "Sent", icon: Send },
  { key: "archive", label: "Archive", icon: Archive }
];

type ViewKey = "mail" | "buckets" | "rules" | "contacts" | "signatures" | "external" | "other-settings";
type PaletteKey = "mint" | "ubuntu" | "fedora" | "plasma" | "graphite";
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

const palettes: {
  key: PaletteKey;
  label: string;
  swatches: [string, string, string];
}[] = [
  { key: "mint", label: "Linux", swatches: ["#0b0f0c", "#22c55e", "#d7ffe2"] },
  { key: "ubuntu", label: "Ubuntu", swatches: ["#e95420", "#77216f", "#f6e9df"] },
  { key: "fedora", label: "Fedora", swatches: ["#3c6eb4", "#294172", "#e7eef9"] },
  { key: "plasma", label: "Plasma", swatches: ["#3daee9", "#1d5b86", "#edf7fc"] },
  { key: "graphite", label: "Graphite", swatches: ["#8b949e", "#30363d", "#f0f3f6"] }
];

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
    smtpPort: 587,
    smtpSecurity: "starttls"
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

function initialPalette(): PaletteKey {
  const stored = localStorage.getItem(PALETTE_KEY);
  return palettes.some((palette) => palette.key === stored) ? (stored as PaletteKey) : "mint";
}

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
              <input
                className="text-input"
                value={promptValue}
                onChange={(event) => setPromptValue(event.target.value)}
                placeholder={dialog.placeholder}
                autoFocus
              />
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
  const [palette, setPalette] = useState<PaletteKey>(initialPalette);
  const [password, setPassword] = useState(() => sessionStorage.getItem(PASSWORD_KEY) ?? "");
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
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const api = useMemo(() => (password ? new ApiClient(password) : null), [password]);
  const activePalette = palettes.find((item) => item.key === palette) ?? palettes[0];

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    localStorage.setItem(PALETTE_KEY, palette);
  }, [palette]);

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
    setActiveThreadId(null);
    setThread(null);
    setSelectedDomainId(null);
    setSelectedMailboxId(null);
    setSelectedBucketId(null);
    setFolderStats({});
    setComposeOpen(false);
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
        setAuthView("login");
      }
    } catch (error) {
      setLoginError(readError(error));
      if (options.fallbackToChecking !== false) {
        setSetup(null);
        setAuthView("checking");
      }
    }
  }, [resetToken]);

  const loadBootstrap = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      const data = await api.bootstrap();
      const hasMailboxes = data.mailboxes.length > 0;
      const defaultDomain = data.domains.find((domain) => domain.is_default === 1) ?? null;
      sessionStorage.setItem(PASSWORD_KEY, password);
      setBootstrap(data);
      setThreads(hasMailboxes ? [] : data.threads);
      setFolderStats(data.stats);
      setSelectedDomainId((current) =>
        current && data.domains.some((domain) => domain.id === current)
          ? current
          : defaultDomain?.id ?? data.domains[0]?.id ?? null
      );
      setSelectedMailboxId((current) => {
        if (current && data.mailboxes.some((mailbox) => mailbox.id === current)) return current;

        const storedDefaultId = localStorage.getItem(DEFAULT_MAILBOX_KEY) ?? "";
        const storedDefaultMailbox = data.mailboxes.find((mailbox) => mailbox.id === storedDefaultId);
        if (storedDefaultMailbox) {
          setDefaultMailboxId(storedDefaultMailbox.id);
          return storedDefaultMailbox.id;
        }

        if (storedDefaultId) {
          localStorage.removeItem(DEFAULT_MAILBOX_KEY);
          setDefaultMailboxId("");
        }

        return data.mailboxes[0]?.id ?? null;
      });
      setSelectedBucketId((current) =>
        current && data.buckets.some((bucket) => bucket.id === current) ? current : data.buckets[0]?.id ?? null
      );
      setActiveThreadId((current) => (hasMailboxes ? null : current ?? data.threads[0]?.thread_id ?? null));
      setLoginError(null);
      setNotice(null);
    } catch (error) {
      const message = readError(error);
      if (isAuthError(error)) {
        sessionStorage.removeItem(PASSWORD_KEY);
        setPassword("");
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
  }, [api, clearPrivateState, password]);

  useEffect(() => {
    if (!password) {
      void loadSetupStatus();
    }
  }, [loadSetupStatus, password]);

  const loadThreads = useCallback(async (options: { preserveSelection?: boolean } = {}) => {
    if (!api) return;
    try {
      const data = await api.threads(folder, selectedMailboxId, query);
      setThreads(data.threads);
      setFolderStats(data.stats);
      setActiveThreadId((current) => {
        if (options.preserveSelection && current && data.threads.some((item) => item.thread_id === current)) {
          return current;
        }
        return data.threads[0]?.thread_id ?? null;
      });
    } catch (error) {
      setNotice(readError(error));
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
    if (activeThreadId) {
      void loadThread(activeThreadId);
    } else {
      setThread(null);
    }
  }, [activeThreadId, loadThread]);

  function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftPassword) return;
    setLoginError(null);
    setAuthNotice(null);
    clearPrivateState();
    setPassword(draftPassword);
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
      sessionStorage.removeItem(PASSWORD_KEY);
      setPassword("");
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
    sessionStorage.removeItem(PASSWORD_KEY);
    setPassword("");
    setLoginError(null);
    setAuthNotice(null);
    clearPrivateState();
    setAuthView(setup && !setup.configurationReady ? "configuration" : setup?.setupRequired ? "setup" : "login");
  }

  if (!password) {
    if (authView === "checking") {
      return (
        <AuthStatusScreen
          busy={busy}
          error={loginError}
          onRetry={retrySetupStatus}
          palette={palette}
          onPaletteChange={setPalette}
        />
      );
    }

    if (authView === "setup") {
      return (
        <SetupScreen
          busy={busy}
          error={loginError}
          defaultDomain={setup?.primaryDomain ?? ""}
          passwordFromSecret={Boolean(setup?.passwordFromSecret)}
          onSubmit={submitSetup}
          palette={palette}
          onPaletteChange={setPalette}
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
          palette={palette}
          onPaletteChange={setPalette}
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
          palette={palette}
          onPaletteChange={setPalette}
        />
      );
    }

    if (authView === "reset-confirm") {
      return (
        <ResetConfirmScreen
          busy={busy}
          error={loginError}
          onSubmit={submitResetConfirm}
          palette={palette}
          onPaletteChange={setPalette}
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
        palette={palette}
        onPaletteChange={setPalette}
      />
    );
  }

  if (!bootstrap) {
    return <AuthGate error={notice} onLock={lock} palette={palette} onPaletteChange={setPalette} />;
  }

  const domains = bootstrap.domains;
  const mailboxes = bootstrap.mailboxes;
  const contacts = bootstrap.contacts;
  const signatures = bootstrap.signatures;
  const externalAccounts = bootstrap.externalAccounts ?? [];
  const buckets = bootstrap.buckets ?? [];
  const activeDomain = domains.find((domain) => domain.id === selectedDomainId) ?? null;
  const activeMailbox = mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? null;
  const activeBucket = buckets.find((bucket) => bucket.id === selectedBucketId) ?? buckets[0] ?? null;
  const changeMailboxScope = (mailboxId: string | null) => {
    setSelectedMailboxId(mailboxId);
    setThreads([]);
    setActiveThreadId(null);
    setThread(null);
  };
  const defaultMailbox = mailboxes.find((mailbox) => mailbox.id === defaultMailboxId) ?? null;
  const setDefaultMailboxPreference = () => {
    if (!activeMailbox) {
      localStorage.removeItem(DEFAULT_MAILBOX_KEY);
      setDefaultMailboxId("");
      setNotice("Default mailbox cleared");
      return;
    }

    localStorage.setItem(DEFAULT_MAILBOX_KEY, activeMailbox.id);
    setDefaultMailboxId(activeMailbox.id);
    setNotice(`Default mailbox set to ${activeMailbox.address}`);
  };
  const changeRefreshIntervalSeconds = (value: number) => {
    const nextValue = Number.isFinite(value) ? Math.round(value) : DEFAULT_REFRESH_INTERVAL_SECONDS;
    setRefreshIntervalSeconds(Math.min(300, Math.max(0, nextValue)));
  };

  async function handleThreadAction(action: "archive" | "unarchive" | "delete") {
    await loadBootstrap();
    await loadThreads();
    setNotice(action === "archive" ? "Thread archived" : action === "delete" ? "Thread deleted" : "Thread restored");
  }

  return (
    <div className="app-shell">
      <Sidebar
        managementHost={bootstrap?.managementHost ?? window.location.host}
        mailboxes={mailboxes}
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
        }}
        onSettingsOpen={setView}
        onLock={lock}
      />

      <main className="workspace">
        <header className="topbar">
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
                  disabled={mailboxes.length === 0}
                  title="Mailbox scope"
                  options={[
                    { value: "", label: "All mailboxes" },
                    ...mailboxes.map((mailbox) => ({ value: mailbox.id, label: mailbox.address }))
                  ]}
                />
                <button
                  className={activeMailbox && defaultMailbox?.id === activeMailbox.id ? "icon-button default-active" : "icon-button"}
                  type="button"
                  onClick={setDefaultMailboxPreference}
                  disabled={mailboxes.length === 0}
                  title={
                    activeMailbox
                      ? defaultMailbox?.id === activeMailbox.id
                        ? `${activeMailbox.address} opens by default`
                        : `Open ${activeMailbox.address} by default`
                      : "Use all mailboxes as the default view"
                  }
                  aria-label={
                    activeMailbox
                      ? defaultMailbox?.id === activeMailbox.id
                        ? `${activeMailbox.address} is the default mailbox`
                        : `Set ${activeMailbox.address} as default mailbox`
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
            <PaletteChooser value={palette} onChange={setPalette} />
            <button className="button ghost" onClick={() => void loadBootstrap()} disabled={busy} title="Refresh">
              <RefreshCw size={16} />
              Refresh
            </button>
            <button
              className="button"
              onClick={async () => {
                if (!api) return;
                setBusy(true);
                try {
                  await api.syncCloudflare();
                  await loadBootstrap();
                  setNotice("Cloudflare sync complete");
                } catch (error) {
                  setNotice(readError(error));
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              <ShieldCheck size={16} />
              Sync Cloudflare
            </button>
            <button className="button primary" onClick={() => setComposeOpen(true)}>
              <Plus size={16} />
              Compose
            </button>
          </div>
        </header>

        {notice ? (
          <div className="notice">
            <AlertTriangle size={16} />
            <span>{notice}</span>
            <button className="icon-button" onClick={() => setNotice(null)} title="Dismiss">
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
        ) : view === "other-settings" ? (
          <OtherSettingsView
            refreshIntervalSeconds={refreshIntervalSeconds}
            onRefreshIntervalChange={changeRefreshIntervalSeconds}
          />
        ) : (
          <section className="main-grid">
            <ThreadList
              threads={threads}
              activeThreadId={activeThreadId}
              folder={folder}
              activeMailbox={activeMailbox}
              onSelect={(threadId) => setActiveThreadId(threadId)}
            />
            <ThreadDetail
              api={api}
              thread={thread}
              mailboxes={mailboxes}
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
        <span>
          <TerminalSquare size={13} />
          omnidock
        </span>
        <span>{activeDomain?.domain ?? `${domains.length} domains`}</span>
        <span>{view === "buckets" ? activeBucket?.name ?? "Buckets" : activeMailbox?.address ?? "All mailboxes"}</span>
        <span>{mailboxes.length} mailboxes</span>
        <span>{activePalette.label}</span>
      </footer>

      {composeOpen ? (
        <ComposeDialog
          api={api}
          mailboxes={mailboxes}
          contacts={contacts}
          onClose={() => setComposeOpen(false)}
          onSent={async () => {
            setComposeOpen(false);
            await loadThreads();
          }}
          initialFrom={activeMailbox?.address ?? null}
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
  onForgot,
  palette,
  onPaletteChange
}: {
  draftPassword: string;
  setDraftPassword: (value: string) => void;
  error: string | null;
  notice: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  resetAvailable: boolean;
  onForgot: () => void;
  palette: PaletteKey;
  onPaletteChange: (palette: PaletteKey) => void;
}) {
  return (
    <main className="login-shell">
      <div className="login-tools">
        <PaletteChooser value={palette} onChange={onPaletteChange} />
      </div>
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
  onRetry,
  palette,
  onPaletteChange
}: {
  busy: boolean;
  error: string | null;
  requirements: RuntimeRequirement[];
  onRetry: () => void;
  palette: PaletteKey;
  onPaletteChange: (palette: PaletteKey) => void;
}) {
  const [copiedName, setCopiedName] = useState<string | null>(null);

  async function copyRequirementName(name: string) {
    await navigator.clipboard.writeText(name);
    setCopiedName(name);
    window.setTimeout(() => setCopiedName((current) => (current === name ? null : current)), 1400);
  }

  return (
    <main className="login-shell">
      <div className="login-tools">
        <PaletteChooser value={palette} onChange={onPaletteChange} />
      </div>
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
  onSubmit,
  palette,
  onPaletteChange
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
  palette: PaletteKey;
  onPaletteChange: (palette: PaletteKey) => void;
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
      <div className="login-tools">
        <PaletteChooser value={palette} onChange={onPaletteChange} />
      </div>
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
  onSubmit,
  palette,
  onPaletteChange
}: {
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (email: string) => Promise<void>;
  palette: PaletteKey;
  onPaletteChange: (palette: PaletteKey) => void;
}) {
  const [email, setEmail] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(email);
  }

  return (
    <main className="login-shell">
      <div className="login-tools">
        <PaletteChooser value={palette} onChange={onPaletteChange} />
      </div>
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
  onSubmit,
  palette,
  onPaletteChange
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (input: { password: string }) => Promise<void>;
  palette: PaletteKey;
  onPaletteChange: (palette: PaletteKey) => void;
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
      <div className="login-tools">
        <PaletteChooser value={palette} onChange={onPaletteChange} />
      </div>
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
  onRetry,
  palette,
  onPaletteChange
}: {
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  palette: PaletteKey;
  onPaletteChange: (palette: PaletteKey) => void;
}) {
  return (
    <main className="login-shell">
      <div className="login-tools">
        <PaletteChooser value={palette} onChange={onPaletteChange} />
      </div>
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
  onLock,
  palette,
  onPaletteChange
}: {
  error: string | null;
  onLock: () => void;
  palette: PaletteKey;
  onPaletteChange: (palette: PaletteKey) => void;
}) {
  return (
    <main className="login-shell">
      <div className="login-tools">
        <PaletteChooser value={palette} onChange={onPaletteChange} />
      </div>
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

function PaletteChooser({
  value,
  onChange
}: {
  value: PaletteKey;
  onChange: (palette: PaletteKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = palettes.find((palette) => palette.key === value) ?? palettes[0];

  return (
    <div className="palette-control">
      <button
        className="button palette-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        title="Color palette"
      >
        <Palette size={16} />
        <span>{selected.label}</span>
      </button>
      {open ? (
        <div className="palette-popover" role="menu">
          {palettes.map((palette) => (
            <button
              key={palette.key}
              className={palette.key === value ? "palette-option active" : "palette-option"}
              type="button"
              onClick={() => {
                onChange(palette.key);
                setOpen(false);
              }}
              role="menuitem"
            >
              <span className="palette-swatches" aria-hidden="true">
                {palette.swatches.map((swatch) => (
                  <i key={swatch} style={{ background: swatch }} />
                ))}
              </span>
              <span>{palette.label}</span>
              {palette.key === value ? <CheckCircle2 size={14} /> : <Circle size={14} />}
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

function Sidebar({
  managementHost,
  mailboxes,
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
          disabled={mailboxes.length === 0}
          options={
            mailboxes.length === 0
              ? [{ value: "", label: "No mailboxes" }]
              : [{ value: "", label: "All mailboxes" }, ...mailboxes.map((mailbox) => ({ value: mailbox.id, label: mailbox.address }))]
          }
        />
      </label>

      <nav className="nav-group">
        {folders.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={folder === item.key ? "nav-item active" : "nav-item"}
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

      <div className="sidebar-section">
        <div className="section-title">
          <Settings size={14} />
          Settings
        </div>
        <button className={view === "rules" ? "settings-link active" : "settings-link"} onClick={() => onSettingsOpen("rules")}>
          <FolderGit2 size={16} />
          <span>Rules</span>
          <b>{stats.mailboxes ?? 0}</b>
        </button>
        <button className={view === "contacts" ? "settings-link active" : "settings-link"} onClick={() => onSettingsOpen("contacts")}>
          <Users size={16} />
          <span>Contacts</span>
          <b>{stats.contacts ?? 0}</b>
        </button>
        <button className={view === "signatures" ? "settings-link active" : "settings-link"} onClick={() => onSettingsOpen("signatures")}>
          <PenLine size={16} />
          <span>Signatures</span>
          <b>{stats.mailboxes ?? 0}</b>
        </button>
        <button className={view === "external" ? "settings-link active" : "settings-link"} onClick={() => onSettingsOpen("external")}>
          <Mail size={16} />
          <span>External</span>
          <b>{stats.external_accounts ?? 0}</b>
        </button>
        <button
          className={view === "other-settings" ? "settings-link active" : "settings-link"}
          onClick={() => onSettingsOpen("other-settings")}
        >
          <SlidersHorizontal size={16} />
          <span>Other Settings</span>
          <b>{refreshIntervalSeconds > 0 ? `${refreshIntervalSeconds}s` : "Off"}</b>
        </button>
      </div>

      <button className="button ghost wide lock-button" onClick={onLock}>
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
          <div className="empty-state">Run Sync Cloudflare to load domains from your Cloudflare account.</div>
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
  const credentialSecretIssue = externalCredentialSecretIssue(draft);

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
    setDraft((current) => {
      const shouldMirrorUsername = !current.username?.trim() || current.username.trim() === current.email.trim();

      return {
        ...current,
        email,
        username: shouldMirrorUsername ? email : current.username
      };
    });
  }

  async function copyExternalText(value: string, message: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    onNotice(message);
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !draft.email.trim()) return;
    if (credentialSecretIssue) {
      onNotice(credentialSecretIssue);
      return;
    }

    setBusy(true);
    try {
      const result = await api.saveExternalAccount(
        {
          ...draft,
          credentialSecretName: credentialSecretName || null
        },
        selectedId
      );
      setSelectedId(result.account.id);
      await onChange();
      onNotice("External account saved");
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
                  <StatusPill ok={account.status === "configured"} label={account.status === "configured" ? "Secret set" : "Needs secret"} />
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
                Username
                <input
                  value={draft.username ?? ""}
                  onChange={(event) => updateDraft({ username: event.target.value })}
                  placeholder={draft.email || "name@gmail.com"}
                />
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

            <div className="external-secret-note">
              <div>
                <span>Cloudflare secret name</span>
                <code>{credentialSecretName || "name@gmail.com"}</code>
              </div>
              <button
                className="button mini"
                type="button"
                onClick={() => void copyExternalText(credentialSecretName, "Secret name copied")}
                disabled={!credentialSecretName}
              >
                <Copy size={13} />
                Copy
              </button>
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

function externalCredentialSecretIssue(draft: ExternalAccountInput): string | null {
  if (draft.authType === "none") return null;
  if (!draft.email.trim()) {
    return "Enter the external email address first. OmniDock uses that same email as the Cloudflare secret name.";
  }
  return null;
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
  const [uploadState, setUploadState] = useState<BucketUploadState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<BucketSearchScope>("current");
  const [searchIncludesText, setSearchIncludesText] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<BucketSearchResultRow[] | null>(null);
  const [searchMeta, setSearchMeta] = useState<{ scanned: number; contentScanned: number; truncated: boolean } | null>(null);
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
        truncated: data.truncated
      });
      setSelectedKey(data.results[0] ? bucketObjectSelectionId(data.results[0]) : null);
      onNotice(data.truncated ? `Search returned first ${data.results.length} results` : `Search found ${data.results.length} result${data.results.length === 1 ? "" : "s"}`);
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
            title="Search inside small text files and searchable PDFs"
          >
            <FileText size={14} />
            Text
          </button>
          <button className="button primary" type="submit" disabled={searching || searchQuery.trim().length < 2}>
            {searching ? <Loader2 size={15} /> : <Search size={15} />}
            Search
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
            <FolderGit2 size={17} />
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
                  {searchIncludesText ? ` · ${searchMeta.contentScanned} content files` : ""}
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
                <span>{searching ? "Searching buckets" : "Loading objects"}</span>
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
                <span>{object.name}</span>
                <b>{formatBytes(object.size)}</b>
                <small>
                  {object.bucketName ? `${object.bucketName} · ` : ""}
                  {object.key}
                </small>
                {object.snippet ? <em>{object.snippet}</em> : null}
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
              <strong>{entry.name}</strong>
              <span>{entry.key}</span>
            </div>
            <small>{entry.message ?? formatBytes(entry.size)}</small>
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
          <iframe className="pdf-preview" src={state.url} title={object.name} />
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
  activeThreadId,
  folder,
  activeMailbox,
  onSelect
}: {
  threads: ThreadRow[];
  activeThreadId: string | null;
  folder: FolderKey;
  activeMailbox: MailboxRow | null;
  onSelect: (threadId: string) => void;
}) {
  return (
    <section className="thread-list">
      <div className="pane-head">
        <div>
          <span>{folder}</span>
          <strong>{activeMailbox?.address ?? "All mailboxes"}</strong>
          <small>{threads.length} threads</small>
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
  folder,
  onSent,
  onThreadAction
}: {
  api: ApiClient | null;
  thread: ThreadPayload | null;
  mailboxes: MailboxRow[];
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
  const sendableMailboxes = useMemo(() => mailboxes.filter((mailbox) => mailbox.enabled === 1), [mailboxes]);
  const preferredFrom = firstMessage?.mailbox ?? sendableMailboxes[0]?.address ?? "";
  const isArchived = Boolean(firstMessage?.archived_at);

  useEffect(() => {
    if (preferredFrom && sendableMailboxes.some((mailbox) => mailbox.address === preferredFrom)) {
      setFrom(preferredFrom);
    } else if (!from || !sendableMailboxes.some((mailbox) => mailbox.address === from)) {
      setFrom(sendableMailboxes[0]?.address ?? "");
    }
  }, [firstMessage?.thread_id, from, preferredFrom, sendableMailboxes]);

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
          <button className="button ghost" onClick={() => void patchArchive()} disabled={busyAction !== null}>
            <Archive size={16} />
            {isArchived ? "Unarchive" : "Archive"}
          </button>
          <button className="button danger" onClick={() => void deleteCurrentThread()} disabled={busyAction !== null}>
            <Trash2 size={16} />
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
              options={sendableMailboxes.map((mailbox) => ({ value: mailbox.address, label: mailbox.address }))}
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
  contacts,
  onClose,
  onSent,
  initialFrom
}: {
  api: ApiClient | null;
  mailboxes: MailboxRow[];
  contacts: ContactRow[];
  onClose: () => void;
  onSent: () => Promise<void>;
  initialFrom: string | null;
}) {
  const sendableMailboxes = useMemo(() => mailboxes.filter((mailbox) => mailbox.enabled === 1), [mailboxes]);
  const initialSendableFrom = sendableMailboxes.some((mailbox) => mailbox.address === initialFrom)
    ? initialFrom ?? ""
    : sendableMailboxes[0]?.address ?? "";
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
    if (!from || !sendableMailboxes.some((mailbox) => mailbox.address === from)) {
      setFrom(sendableMailboxes[0]?.address ?? "");
    }
  }, [from, sendableMailboxes]);

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
            options={sendableMailboxes.map((mailbox) => ({ value: mailbox.address, label: mailbox.address }))}
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

type AttachmentPreviewKind = "image" | "pdf" | "text" | "download";

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
    error: string | null;
    kind: AttachmentPreviewKind;
    url: string | null;
    text: string | null;
    blob: Blob | null;
  }>({
    loading: true,
    error: null,
    kind: "download",
    url: null,
    text: null,
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

      setState({ loading: true, error: null, kind: "download", url: null, text: null, blob: null });

      try {
        const blob = await api.downloadAttachment(attachment.id);
        objectUrl = URL.createObjectURL(blob);
        const kind = detectAttachmentPreviewKind(attachment, blob);
        const text = kind === "text" ? await blob.text() : null;

        if (active) {
          setState({ loading: false, error: null, kind, url: objectUrl, text, blob });
        }
      } catch (error) {
        if (active) {
          setState({ loading: false, error: readError(error), kind: "download", url: null, text: null, blob: null });
        }
      }
    }

    void loadPreview();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, attachment]);

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
    text: "Enable Cloudflare Email Sending for this domain, then run Sync Cloudflare.",
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
      text: "Email Routing is not active for this domain. Enable routing in Cloudflare, then run Sync Cloudflare.",
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
  if (blob.size <= 2 * 1024 * 1024 && (contentType.startsWith("text/") || textExtensions.some((ext) => filename.endsWith(ext)))) {
    return "text";
  }

  return "download";
}

function buildR2UploadKey(prefix: string, filename: string): string {
  const safeName = filename.replace(/[\\\u0000-\u001f\u007f]/g, "_").replace(/^\/+/, "").trim() || "upload";
  return `${prefix}${safeName}`.replace(/^\/+/, "");
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
