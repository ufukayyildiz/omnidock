import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  FileUp,
  FolderGit2,
  Inbox,
  Mail,
  Palette,
  Paperclip,
  PenLine,
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
  Star,
  TerminalSquare,
  Trash2,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiClient,
  AttachmentDraft,
  ContactInput,
  confirmPasswordReset,
  createAdmin,
  requestPasswordReset,
  setupStatus
} from "./api";
import {
  AttachmentRow,
  BootstrapPayload,
  ContactRow,
  DomainRow,
  FolderKey,
  MailboxRow,
  MailboxSignatureRow,
  RuntimeRequirement,
  SetupStatusPayload,
  ThreadPayload,
  ThreadRow
} from "./types";

const PASSWORD_KEY = "emailfox.password";
const PALETTE_KEY = "emailfox.palette";
const DEFAULT_MAILBOX_KEY = "emailfox.defaultMailbox";

const folders: { key: FolderKey; label: string; icon: typeof Inbox }[] = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "sent", label: "Sent", icon: Send },
  { key: "archive", label: "Archive", icon: Archive }
];

type ViewKey = "mail" | "rules" | "contacts" | "signatures";
type PaletteKey = "mint" | "ubuntu" | "fedora" | "plasma" | "graphite";
type SettingsViewKey = Exclude<ViewKey, "mail">;
type AuthViewKey = "checking" | "configuration" | "login" | "setup" | "reset-request" | "reset-confirm";

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

function initialPalette(): PaletteKey {
  const stored = localStorage.getItem(PALETTE_KEY);
  return palettes.some((palette) => palette.key === stored) ? (stored as PaletteKey) : "mint";
}

export function App() {
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
  const [defaultMailboxId, setDefaultMailboxId] = useState(() => localStorage.getItem(DEFAULT_MAILBOX_KEY) ?? "");
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

  const clearPrivateState = useCallback(() => {
    setBootstrap(null);
    setThreads([]);
    setActiveThreadId(null);
    setThread(null);
    setSelectedDomainId(null);
    setSelectedMailboxId(null);
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
      setActiveThreadId((current) => (hasMailboxes ? null : current ?? data.threads[0]?.thread_id ?? null));
      setLoginError(null);
      setNotice(null);
    } catch (error) {
      const message = readError(error);
      sessionStorage.removeItem(PASSWORD_KEY);
      setPassword("");
      setAuthView("login");
      setLoginError(message);
      setNotice(null);
      clearPrivateState();
    } finally {
      setBusy(false);
    }
  }, [api, clearPrivateState, password]);

  useEffect(() => {
    if (!password) {
      void loadSetupStatus();
    }
  }, [loadSetupStatus, password]);

  const loadThreads = useCallback(async () => {
    if (!api) return;
    try {
      const data = await api.threads(folder, selectedMailboxId, query);
      setThreads(data.threads);
      setFolderStats(data.stats);
      setActiveThreadId(data.threads[0]?.thread_id ?? null);
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
  const activeDomain = domains.find((domain) => domain.id === selectedDomainId) ?? null;
  const activeMailbox = mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? null;
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
        stats={folderStats}
        folder={folder}
        view={view}
        selectedMailboxId={selectedMailboxId}
        onMailboxChange={changeMailboxScope}
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
                <select
                  value={selectedMailboxId ?? ""}
                  onChange={(event) => changeMailboxScope(event.target.value || null)}
                  disabled={mailboxes.length === 0}
                  title="Mailbox scope"
                >
                  <option value="">All mailboxes</option>
                  {mailboxes.map((mailbox) => (
                    <option key={mailbox.id} value={mailbox.id}>
                      {mailbox.address}
                    </option>
                  ))}
                </select>
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

        {view === "rules" ? (
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
          emailfox
        </span>
        <span>{activeDomain?.domain ?? `${domains.length} domains`}</span>
        <span>{activeMailbox?.address ?? "All mailboxes"}</span>
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
          <img src="/emailfox-mark.svg" alt="" />
          <div>
            <h1>Emailfox</h1>
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
          <img src="/emailfox-mark.svg" alt="" />
          <div>
            <h1>Emailfox</h1>
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
          <img src="/emailfox-mark.svg" alt="" />
          <div>
            <h1>Emailfox</h1>
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
          <img src="/emailfox-mark.svg" alt="" />
          <div>
            <h1>Emailfox</h1>
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
          <img src="/emailfox-mark.svg" alt="" />
          <div>
            <h1>Emailfox</h1>
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
          <img src="/emailfox-mark.svg" alt="" />
          <div>
            <h1>Emailfox</h1>
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
          <img src="/emailfox-mark.svg" alt="" />
          <div>
            <h1>Emailfox</h1>
            <p>{window.location.host || "Cloudflare Workers"}</p>
          </div>
        </div>
        <div className={error ? "login-error" : "auth-check"}>
          {error ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
          <span>{error ?? "Checking password"}</span>
        </div>
        <button className="button ghost wide" type="button" onClick={onLock}>
          Lock
        </button>
      </section>
    </main>
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
  view: ViewKey;
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
    }
  };
  const item = labels[view === "mail" ? "rules" : view];
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

function Sidebar({
  managementHost,
  mailboxes,
  stats,
  folder,
  view,
  selectedMailboxId,
  onMailboxChange,
  onFolderChange,
  onSettingsOpen,
  onLock
}: {
  managementHost: string;
  mailboxes: MailboxRow[];
  stats: Record<string, number>;
  folder: FolderKey;
  view: ViewKey;
  selectedMailboxId: string | null;
  onMailboxChange: (id: string | null) => void;
  onFolderChange: (folder: FolderKey) => void;
  onSettingsOpen: (view: SettingsViewKey) => void;
  onLock: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <img src="/emailfox-mark.svg" alt="" />
        <div>
          <strong>Emailfox</strong>
          <span>{managementHost}</span>
        </div>
      </div>

      <label className="mailbox-switcher">
        <span>Mailbox</span>
        <select
          value={selectedMailboxId ?? ""}
          onChange={(event) => onMailboxChange(event.target.value || null)}
          disabled={mailboxes.length === 0}
        >
          {mailboxes.length === 0 ? (
            <option value="">No mailboxes</option>
          ) : (
            <>
              <option value="">All mailboxes</option>
              {mailboxes.map((mailbox) => (
                <option key={mailbox.id} value={mailbox.id}>
                  {mailbox.address}
                </option>
              ))}
            </>
          )}
        </select>
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
  const [draft, setDraft] = useState<ContactInput>({ email: "", name: "", company: "", tags: "", notes: "" });
  const [busy, setBusy] = useState(false);

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !draft.email?.trim()) return;

    setBusy(true);
    try {
      await api.addContact(draft);
      setDraft({ email: "", name: "", company: "", tags: "", notes: "" });
      await onChange();
      onNotice("Contact saved");
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
      if (parsed.length === 0) {
        onNotice("No contacts found in file");
        return;
      }
      const result = await api.importContacts(parsed, file.name.toLowerCase().endsWith(".vcf") ? "vcard" : "upload");
      await onChange();
      onNotice(`${result.imported} contacts imported`);
    } catch (error) {
      onNotice(readError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-shell">
      <div className="settings-grid">
        <section className="settings-card">
          <header>
            <div>
              <span>Manual</span>
              <strong>Add contact</strong>
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
            <button className="button primary" type="submit" disabled={busy || !draft.email?.trim()}>
              <Save size={16} />
              Save contact
            </button>
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
              onChange={(event) => void importFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <p className="settings-note">CSV headers can be email, name, company, tags and notes. Plain text imports every email address it finds.</p>
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
                <div className="contact-row" key={contact.id}>
                  <Users size={15} />
                  <div>
                    <strong>{contact.name || contact.email}</strong>
                    <span>{contact.email}</span>
                  </div>
                  <b>{contact.company || contact.tags || contact.source}</b>
                </div>
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
  const [textSignature, setTextSignature] = useState("");
  const [htmlSignature, setHtmlSignature] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedMailboxId && mailboxes[0]) {
      setSelectedMailboxId(mailboxes[0].id);
    }
  }, [mailboxes, selectedMailboxId]);

  useEffect(() => {
    const signature = signatures.find((item) => item.mailbox_id === selectedMailboxId);
    setTextSignature(signature?.text_signature ?? "");
    setHtmlSignature(signature?.html_signature ?? "");
    setEnabled(signature?.enabled !== 0);
  }, [selectedMailboxId, signatures]);

  const selectedMailbox = mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? null;

  async function saveSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !selectedMailbox) return;

    setBusy(true);
    try {
      await api.saveSignature(selectedMailbox.id, { textSignature, htmlSignature, enabled });
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
          <form className="stack-form" onSubmit={saveSignature}>
            <label className="check-row">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              Enabled
            </label>
            <label>
              Plain text
              <textarea
                value={textSignature}
                onChange={(event) => setTextSignature(event.target.value)}
                placeholder={"Best regards,\nEmailfox Team"}
              />
            </label>
            <label>
              HTML
              <textarea
                value={htmlSignature}
                onChange={(event) => setHtmlSignature(event.target.value)}
                placeholder="<p>Best regards,<br>Emailfox Team</p>"
              />
            </label>
            <button className="button primary" type="submit" disabled={busy || !selectedMailbox}>
              <Save size={16} />
              Save signature
            </button>
          </form>
        </section>
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
  const [replyText, setReplyText] = useState("");
  const [from, setFrom] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<AttachmentDraft[]>([]);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const firstMessage = thread?.messages[0] ?? null;
  const lastInbound = [...(thread?.messages ?? [])].reverse().find((message) => message.direction === "inbound");
  const sendableMailboxes = useMemo(() => mailboxes.filter((mailbox) => mailbox.enabled === 1), [mailboxes]);
  const preferredFrom = firstMessage?.mailbox ?? sendableMailboxes[0]?.address ?? "";

  useEffect(() => {
    if (preferredFrom && sendableMailboxes.some((mailbox) => mailbox.address === preferredFrom)) {
      setFrom(preferredFrom);
    } else if (!from || !sendableMailboxes.some((mailbox) => mailbox.address === from)) {
      setFrom(sendableMailboxes[0]?.address ?? "");
    }
  }, [firstMessage?.thread_id, from, preferredFrom, sendableMailboxes]);

  useEffect(() => {
    setReplyText("");
    setReplyAttachments([]);
    setReplyError(null);
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
    if (!api || (!replyText.trim() && replyAttachments.length === 0) || !from || !lastInbound || !firstMessage) return;
    setReplyError(null);
    setBusyAction("reply");
    try {
      await api.send({
        from,
        to: lastInbound.from_address,
        subject: firstMessage.subject.startsWith("Re:") ? firstMessage.subject : `Re: ${firstMessage.subject}`,
        text: replyText,
        replyToThreadId: firstMessage.thread_id,
        attachments: replyAttachments
      });
      setReplyText("");
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
    const action = folder === "archive" ? "unarchive" : "archive";
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
    const confirmed = window.confirm("Delete this thread and its stored message files permanently?");
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
            {folder === "archive" ? "Unarchive" : "Archive"}
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
            <pre>{message.text_body || message.snippet || "No text body"}</pre>
            {thread.attachments.filter((attachment) => attachment.message_id === message.id).length > 0 ? (
              <div className="attachment-strip">
                {thread.attachments
                  .filter((attachment) => attachment.message_id === message.id)
                  .map((attachment) => (
                    <button
                      className="attachment-pill"
                      key={attachment.id}
                      type="button"
                      onClick={() => void downloadAttachment(api, attachment)}
                    >
                      <Download size={13} />
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
            <select value={from} onChange={(event) => setFrom(event.target.value)}>
              {sendableMailboxes.map((mailbox) => (
                <option key={mailbox.id} value={mailbox.address}>
                  {mailbox.address}
                </option>
              ))}
            </select>
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
        <textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="Reply" />
        <AttachmentPicker value={replyAttachments} onChange={setReplyAttachments} />
        <button
          className="button primary send-button"
          type="submit"
          disabled={busyAction !== null || (!replyText.trim() && replyAttachments.length === 0) || !from}
        >
          <SendHorizontal size={16} />
          {busyAction === "reply" ? "Sending" : "Send reply"}
        </button>
      </form>
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
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!from || !sendableMailboxes.some((mailbox) => mailbox.address === from)) {
      setFrom(sendableMailboxes[0]?.address ?? "");
    }
  }, [from, sendableMailboxes]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !from || !to.trim() || !subject.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api.send({ from, to, subject, text, attachments });
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
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            {sendableMailboxes.map((mailbox) => (
              <option key={mailbox.id} value={mailbox.address}>
                {mailbox.address}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <input value={to} onChange={(event) => setTo(event.target.value)} placeholder="ops@example.com" />
        </label>
        {contacts.length > 0 ? (
          <label>
            Contacts
            <select
              value=""
              onChange={(event) => {
                const email = event.target.value;
                if (!email) return;
                setTo((current) => appendAddress(current, email));
              }}
            >
              <option value="">Select contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.email}>
                  {contact.name ? `${contact.name} <${contact.email}>` : contact.email}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Subject
          <input value={subject} onChange={(event) => setSubject(event.target.value)} />
        </label>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Message" />
        <AttachmentPicker value={attachments} onChange={setAttachments} />
        <button className="button primary wide" type="submit" disabled={busy || !from || !to.trim() || !subject.trim()}>
          <SendHorizontal size={16} />
          {busy ? "Sending" : "Send"}
        </button>
      </form>
    </div>
  );
}

function AttachmentPicker({
  value,
  onChange
}: {
  value: AttachmentDraft[];
  onChange: (attachments: AttachmentDraft[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

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
    }
  }

  return (
    <div className="attachment-picker">
      <label className="attachment-add">
        <Paperclip size={15} />
        <span>Add attachment</span>
        <input type="file" multiple onChange={(event) => void addFiles(event.target.files)} />
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

function appendAddress(current: string, email: string): string {
  const values = current
    .split(/[,\n;]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (values.includes(email.toLowerCase())) {
    return current;
  }
  return values.length > 0 ? `${current.trim()}, ${email}` : email;
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

async function downloadAttachment(api: ApiClient | null, attachment: AttachmentRow): Promise<void> {
  if (!api) return;
  const blob = await api.downloadAttachment(attachment.id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function parseContactsFromText(text: string, filename: string): ContactInput[] {
  const lowerName = filename.toLowerCase();
  const contacts = lowerName.endsWith(".vcf") ? parseVcards(text) : parseDelimitedContacts(text);
  const unique = new Map<string, ContactInput>();

  for (const contact of contacts) {
    const email = contact.email?.trim().toLowerCase();
    if (email && !unique.has(email)) {
      unique.set(email, { ...contact, email });
    }
  }

  return [...unique.values()].slice(0, 1000);
}

function parseVcards(text: string): ContactInput[] {
  const contacts: ContactInput[] = [];
  for (const block of text.split(/BEGIN:VCARD/i)) {
    const email = block.match(/^EMAIL[^:]*:(.+)$/im)?.[1]?.trim();
    if (email) {
      contacts.push({
        email,
        name: block.match(/^FN[^:]*:(.+)$/im)?.[1]?.trim() ?? null,
        company: block.match(/^ORG[^:]*:(.+)$/im)?.[1]?.trim() ?? null,
        tags: "vcard",
        notes: null
      });
    }
  }
  return contacts;
}

function parseDelimitedContacts(text: string): ContactInput[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((item) => item.toLowerCase());
  const emailColumn = header.findIndex((item) => ["email", "e-mail", "mail"].includes(item));

  if (emailColumn >= 0) {
    return lines.slice(1).flatMap((line) => {
      const cells = parseCsvLine(line);
      const email = cells[emailColumn]?.trim();
      if (!email) return [];
      return [
        {
          email,
          name: cellByHeader(cells, header, ["name", "full name", "display name"]),
          company: cellByHeader(cells, header, ["company", "organization", "org"]),
          tags: cellByHeader(cells, header, ["tags", "tag", "groups"]),
          notes: cellByHeader(cells, header, ["notes", "note"])
        }
      ];
    });
  }

  const contacts: ContactInput[] = [];
  const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
  for (const line of lines) {
    for (const match of line.matchAll(emailPattern)) {
      const email = match[0];
      const name = line
        .slice(0, match.index)
        .replace(/[<,;"']/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      contacts.push({ email, name: name || null });
    }
  }
  return contacts;
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
