"use client";
import "./forge-studio.css";
import { AssemblyDrawing } from "@/components/assembly-drawing";
import { ForgeMark } from "@/components/forge-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Command,
  FileCode2,
  Folder,
  FolderOpen,
  Globe2,
  History,
  LayoutTemplate,
  LogOut,
  Menu,
  MessageSquare,
  Monitor,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Smartphone,
  Sparkles,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { ProjectActions, VisualPreview } from "@/components/project-tools";
import type {
  RuntimeChoice,
  ProviderState,
  KeyHeaders,
} from "@/components/provider-settings";
import { reviewSources } from "@/lib/project-review";
const ProviderSettings = dynamic(() => import("@/components/provider-settings").then(module => module.ProviderSettings), { loading: () => <p role="status">Opening settings…</p> });
const DatabaseInspector = dynamic(() => import("@/components/database-inspector").then(module => module.DatabaseInspector), { loading: () => <p role="status">Opening project data…</p> });
const BuildDemo = dynamic(() => import("@/components/build-demo").then((module) => module.BuildDemo), { loading: () => <p role="status">Opening guided build…</p> });
const CodePane = dynamic(
  () => import("@/components/code-pane").then((m) => m.CodePane),
  { ssr: false, loading: () => <p className="fx-empty">Opening files…</p> },
);
type Blueprint = {
  summary: string;
  palette: string[];
  typography: string;
  tables: string[];
  endpoints: string[];
  pages: string[];
};
type Project = { id: string; title: string };
type Details = Project & {
  revision: number;
  preview: string | null;
  blueprint?: Blueprint | null;
  files: { path: string; content: string }[];
  runs: { id: string; prompt: string; status: string; report: string }[];
};
type View = "Agent" | "Blueprint" | "Workbench" | "History";
type Tab = "Code" | "Preview" | "Data & API" | "Terminal";
const views = {
  Agent: Sparkles,
  Blueprint: Boxes,
  Workbench: FileCode2,
  History: History,
};
const ideas = [
  {
    icon: Globe2,
    title: "Launch a waitlist",
    detail: "Collect signups and track referrals.",
    text: "Build a launch site for my startup. Explain the product, answer common questions, and save waitlist signups with a referral source.",
  },
  {
    icon: BookOpen,
    title: "Organize research",
    detail: "Turn interviews into experiments.",
    text: "Build a customer research board. Save interview notes, tag each by hypothesis, and filter the next experiments by priority.",
  },
  {
    icon: LayoutTemplate,
    title: "Open a client portal",
    detail: "Share milestones and collect feedback.",
    text: "Build a client portal for my studio. Give each client a private project view with milestones, deliverables and a feedback form.",
  },
];
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    const opener = document.activeElement;
    el?.showModal();
    return () => {
      el?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="fx-modal"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-labelledby="modal-title"
    >
      <section>
        <div className="fx-row">
          <h2 id="modal-title">{title}</h2>
          <button aria-label="Close" onClick={close}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </dialog>
  );
}
function PlanCard({ plan }: { plan: Blueprint }) {
  return (
    <article className="fx-plan">
      <span className="fx-overline">ARCHITECT / BLUEPRINT</span>
      <h2>{plan.summary}</h2>
      <div className="fx-plan-grid">
        {Object.entries({
          Pages: plan.pages,
          "Data models": plan.tables,
          "API endpoints": plan.endpoints,
          "Color palette": plan.palette,
          Typography: [plan.typography],
        }).map(([name, items]) => (
          <section key={name}>
            <h3>{name}</h3>
            {items.length ? (
              <ul>
                {items.map((s, i) => (
                  <li key={i}>
                    {/^#[0-9a-f]{6}$/i.test(s) && (
                      <i style={{ background: s }} />
                    )}
                    {s}
                  </li>
                ))}
              </ul>
            ) : (
              <p>None specified</p>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}
export default function Studio() {
  const [user, setUser] = useState<{ email: string } | null>(null),
    [loading, setLoading] = useState(true),
    [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Details | null>(null);
  const [watching, setWatching] = useState(false);
  const watchButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<View>("Agent"),
    [tab, setTab] = useState<Tab>("Code"),
    [modal, setModal] = useState<
      "menu" | "new" | "settings" | "ideas" | "search" | null
    >(null);
  const [prompt, setPrompt] = useState(""),
    [title, setTitle] = useState(""),
    [query, setQuery] = useState(""),
    [engine, setEngine] = useState<RuntimeChoice>("auto"),
    [mode, setMode] = useState<"plan" | "build">("build");
  const [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [notice, setNotice] = useState(""),
    [activity, setActivity] = useState<string[]>([]),
    [logs, setLogs] = useState(""),
    [plan, setPlan] = useState<Blueprint | null>(null);
  const [files, setFiles] = useState<Record<string, string>>({}),
    [file, setFile] = useState(""),
    [viewport, setViewport] = useState("Desktop"),
    [inspect, setInspect] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [phase, setPhase] = useState<
    "Architect" | "Data & API" | "Interface" | "Verifier"
  >("Architect");
  const [keyHeaders, setKeyHeaders] = useState<KeyHeaders>({}),
    [providerStatus, setProviderStatus] = useState<ProviderState | null>(null);
  const [model, setModel] = useState("Model & keys"),
    [cloud, setCloud] = useState(false),
    [missing, setMissing] = useState<string[]>([]);
  const field = useRef<HTMLTextAreaElement>(null),
    abort = useRef<AbortController | null>(null),
    serial = useRef(0),
    logBox = useRef<HTMLPreElement>(null),
    running = useRef(false);
  const message = (e: unknown) =>
    setNotice(e instanceof Error ? e.message : "Request failed.");
  const call = useCallback(async (url: string, options: RequestInit = {}) => {
    const res = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    if (!res.ok) {
      if (res.status === 401) {
        setUser(null);
        setKeyHeaders({});
        setProviderStatus(null);
        setProject(null);
        setProjects([]);
        setPlan(null);
        setFiles({});
        setActivity([]);
        setLogs("");
      }
      throw Error((await res.json()).error || "Request failed.");
    }
    return res;
  }, []);
  const commit = useCallback((item: Details) => {
    setProject(item);
    setFiles(Object.fromEntries(item.files.map((f) => [f.path, f.content])));
    setFile((p) =>
      item.files.some((f) => f.path === p) ? p : item.files[0]?.path || "",
    );
    setPlan(item.blueprint || null);
  }, []);
  const select = useCallback(async (id: string) => {
    const seq = ++serial.current;
    const item = await (
      await call("/api/projects?id=" + encodeURIComponent(id))
    ).json();
    if (seq !== serial.current) return;
    commit(item);
    setActivity([]);
    setLogs("");
    setModal(null);
  }, [call, commit]);
  useEffect(() => {
    let active = true;
    async function load() {
      const session = await (await call("/api/auth/session")).json();
      if (!active) return;
      setUser(session.user);
      if (session.user) {
        const draft = sessionStorage.getItem("forge.authDraft");
        if (draft) {
          setPrompt(draft);
          sessionStorage.removeItem("forge.authDraft");
        }
        if (sessionStorage.getItem("forge.authMode") === "plan")
          setMode("plan");
        const prior = sessionStorage.getItem("forge.authEngine");
        if (prior === "local" || prior === "instant" || prior === "cloud")
          setEngine(prior);
        sessionStorage.removeItem("forge.authMode");
        sessionStorage.removeItem("forge.authEngine");
        const data = await (await call("/api/projects")).json();
        if (!active) return;
        setProjects(data.projects);
        setCloud(!!data.cloudAvailable);
        setModel(data.modelLabel || "Claude Sonnet");
        setMissing(data.missing || []);
        const settings = await (await call("/api/settings")).json();
        if (!active) return;
        setProviderStatus(settings);
        if (data.projects[0]) await select(data.projects[0].id);
      }
    }
    load()
      .catch((e) => {
        if (active) message(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, [call, select]);
  useEffect(() => {
    if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [logs, tab]);
  function rememberDraft() {
    try {
      sessionStorage.setItem("forge.authDraft", prompt);
      sessionStorage.setItem("forge.authMode", mode);
      sessionStorage.setItem("forge.authEngine", engine);
    } catch { /* Navigation still works when storage is unavailable. */ }
  }
  function authenticate(path = "/sign-in") {
    rememberDraft();
    window.location.assign(path);
  }
  function openNew() {
    if (!user) {
      authenticate("/sign-up");
      return;
    }
    setTitle("");
    setModal("new");
  }
  function navigate(v: View) {
    setView(v);
    setModal(null);
  }
  function applyIdea(text: string) {
    setWatching(false);
    setPrompt(text);
    navigate("Agent");
    requestAnimationFrame(() => field.current?.focus());
  }
  async function add(name: string) {
    const { newProject } = await import("@/lib/validation");
    const parsed = newProject.safeParse({ title: name });
    if (!parsed.success)
      throw Error("Use a project name between 2 and 80 characters.");
    const item = await (
      await call("/api/projects", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      })
    ).json();
    setProjects((a) => [item, ...a]);
    await select(item.id);
    return item as Project;
  }
  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      await add(title.trim());
      setView("Agent");
      setNotice("Project created.");
    } catch (e) {
      message(e);
    } finally {
      setCreating(false);
    }
  }
  async function logout() {
    try {
      await call("/api/auth/sign-out", { method: "POST", body: "{}" });
      try { sessionStorage.removeItem("forge.authDraft"); } catch { /* Sign-out succeeds without storage. */ }
      location.replace("/");
    } catch (e) {
      message(e);
    }
  }
  async function run() {
    if (running.current) return;
    if (!user) {
      authenticate();
      return;
    }
    if (prompt.trim().length < 8) {
      setNotice("Describe what you want to make in at least eight characters.");
      return;
    }
    if (missing.length) {
      setNotice(
        "Generation needs " +
          missing.join(" and ") +
          ". Open Engine settings for setup details.",
      );
      setModal("settings");
      return;
    }
    running.current = true;
    setBusy(true);
    setPhase("Architect");
    let id = project?.id;
    const controller = new AbortController();
    abort.current = controller;
    try {
      if (!id) id = (await add(prompt.trim().slice(0, 65))).id;
      const payload = {
        projectId: id,
        revision: project?.revision || 0,
        prompt,
        engine,
        mode,
      };
      const { brief } = await import("@/lib/validation");
      if (!brief.safeParse(payload).success)
        throw Error("Check your brief and try again.");
      setLogs("");
      setActivity([]);
      setView("Blueprint");
      setNotice("");
      let done = false,
        planReceived = false;
      const res = await call("/api/sandbox", {
        headers: { ...keyHeaders, Accept: "application/x-ndjson" },
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      const reader = res.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const r = await reader.read();
        buffer += decoder.decode(r.value, { stream: !r.done });
        let n;
        while ((n = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, n);
          buffer = buffer.slice(n + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === "error") throw Error(e.text);
          if (e.type === "stage" && e.text.startsWith("Builder:"))
            setPhase(e.text.includes("interface") ? "Interface" : "Data & API");
          if (e.type === "fileStart" && /\.(tsx|jsx|css)$/.test(e.path))
            setPhase("Interface");
          if (
            e.type === "repair" ||
            (e.type === "stage" &&
              /Checking TypeScript|Verifying|Starting preview|Verifier/.test(
                e.text,
              ))
          )
            setPhase("Verifier");
          if (e.type === "blueprint") {
            setPlan(e.blueprint);
            planReceived = true;
          }
          if (e.type === "planned") {
            done = true;
            setView("Blueprint");
          }
          if (e.type === "fileStart") {
            setFile(e.path);
            setFiles((f) => ({ ...f, [e.path]: "" }));
          }
          if (e.type === "fileChunk")
            setFiles((f) => ({ ...f, [e.path]: (f[e.path] || "") + e.text }));
          if (e.type === "stdout" || e.type === "stderr")
            setLogs((l) => (l + e.text).slice(-120000));
          if (e.type === "shell" || e.type === "start")
            setLogs((l) => (l + "\n$ " + e.command + "\n").slice(-120000));
          const note =
            e.type === "fileComplete"
              ? "Wrote " + e.path
              : e.type === "stage"
                ? e.text
                : e.type === "repair"
                  ? "Repair " + e.attempt + " · " + e.text
                  : e.type === "artifact"
                    ? e.title
                    : null;
          if (note) setActivity((a) => [...a, note].slice(-100));
          if (e.type === "ready") {
            done = true;
            setView("Workbench");
            setTab("Preview");
          }
        }
        if (r.done) break;
      }
      if (!done) throw Error("The stream closed before verification.");
      setNotice(
        mode === "plan" && planReceived
          ? "Blueprint saved."
          : "Revision ready.",
      );
      if (mode === "build") setPrompt("");
      else setMode("build");
    } catch (e) {
      if (controller.signal.aborted) setNotice("Run stopped.");
      else message(e);
    } finally {
      if (id) {
        try {
          commit(
            await (
              await call("/api/projects?id=" + encodeURIComponent(id))
            ).json(),
          );
        } catch (e) {
          message(e);
        }
      }
      setBusy(false);
      running.current = false;
      abort.current = null;
    }
  }
  const engineLabel =
    engine === "local"
      ? "Local Docker"
      : engine === "cloud" || (engine === "auto" && cloud)
        ? "E2B cloud VM"
        : engine === "auto" &&
            project?.preview &&
            !project.preview.startsWith("/api/instant/preview")
          ? "Linux sandbox"
          : "Built-in instant engine";
  const savedFiles = Object.fromEntries(
    (project?.files || []).map((f) => [f.path, f.content]),
  );
  const projectRows = projects
    .filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))
    .map((p) => (
      <button
        key={p.id}
        className="fx-project"
        aria-current={project?.id === p.id ? "page" : undefined}
        disabled={busy || creating}
        onClick={() => select(p.id).catch(message)}
      >
        <Folder size={15} />
        <span>{p.title}</span>
      </button>
    ));
  const nav = (compact = false) =>
    (Object.keys(views) as View[]).map((v) => {
      const Icon = views[v];
      return (
        <button
          type="button"
          key={v}
          aria-label={v}
          title={v}
          aria-current={view === v ? "page" : undefined}
          onClick={() => navigate(v)}
        >
          <Icon size={19} />
          {!compact && v}
        </button>
      );
    });
  const newBtn = (
    <button
      className="fx-primary"
      disabled={busy || loading || creating}
      onClick={openNew}
    >
      <Plus size={16} />
      New project
    </button>
  );
  const who = user ? (
    <button disabled={busy} onClick={logout}>
      <LogOut size={15} />
      Sign out
    </button>
  ) : (
    <div className="fx-auth">
      <Link href="/sign-in" onClick={rememberDraft}>
        Sign in
      </Link>
      <Link className="fx-primary" href="/sign-up" onClick={rememberDraft}>
        Create account
      </Link>
    </div>
  );
  const composer = (
    <form
      className="fx-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <label htmlFor="brief" className="fx-brief-label"><span>Project brief</span><span aria-hidden="true">INPUT / 01</span></label>
      <textarea
        id="brief"
        ref={field}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        minLength={8}
        maxLength={6000}
        required
        placeholder="Describe the app you want to build…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="fx-composer-foot">
        <div className="fx-composer-options">
          <button
            type="button"
            onClick={() => setModal("settings")}
            aria-label={model + " settings"}
          >
            <Command size={14} />
            <span>{model}</span>
            <ChevronDown size={12} />
          </button>
          <label className="fx-mode">
            <select
              aria-label="Agent mode"
              disabled={busy}
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="build">Build app</option>
              <option value="plan">Plan only</option>
            </select>
          </label>
        </div>
        {busy ? (
          <button
            type="button"
            className="fx-send"
            aria-label="Stop run"
            onClick={() => abort.current?.abort()}
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            className="fx-send"
            disabled={loading || creating}
            aria-label={mode === "plan" ? "Create blueprint" : "Run build"}
            title={mode === "plan" ? "Create blueprint" : "Run build"}
          >
            <span>{mode === "plan" ? "Plan" : "Run build"}</span><ArrowUpRight size={16} />
          </button>
        )}
      </div>
    </form>
  );
  return (
    <main className="forge">
      <aside className="fx-library">
        <div className="fx-library-head">
          <button className="fx-wordmark" aria-label="ForgeAI home" onClick={() => navigate("Agent")}><ForgeMark />ForgeAI</button>
          <button
            aria-label="Search projects"
            onClick={() => {
              setQuery("");
              setModal("search");
            }}
          >
            <Search size={17} />
          </button>
        </div>
        <div className="fx-library-actions">
          {newBtn}
          <button className="fx-outline" onClick={() => setModal("ideas")}>
            <LayoutTemplate size={15} />
            Prompt library
          </button>
        </div>
        <div className="fx-section-tag">WORKSPACE</div>
        <nav className="fx-side-nav">{nav()}</nav>
        <div className="fx-section-tag fx-project-tag">
          PROJECTS
          <button disabled={busy} aria-label="Add project" onClick={openNew}>
            <Plus size={13} />
          </button>
        </div>
        <div className="fx-projects">
          {projects.map((p) => (
            <button
              key={p.id}
              className="fx-project"
              aria-current={project?.id === p.id ? "page" : undefined}
              disabled={busy}
              onClick={() => select(p.id).catch(message)}
            >
              <Folder size={15} />
              <span>{p.title}</span>
            </button>
          ))}
          {!projects.length && (
            <p>
              {user
                ? "Your projects will appear here."
                : "Sign in to see your projects."}
            </p>
          )}
        </div>
        <div className="fx-library-end">
          <span className="fx-brand-mini">
            <ForgeMark />
            FORGE WORKSPACE
          </span>
          <p>{user?.email || "A workspace for founders"}</p>
          {who}
        </div>
      </aside>
      <section className="fx-main">
        <header className="fx-top">
          <button className="fx-mobile-logo" onClick={() => navigate("Agent")}>
            <ForgeMark />
            <span>
              ForgeAI<small>by Merova</small>
            </span>
          </button>
          <div className="fx-crumb">
            {user && projects.length > 0 && (
              <select
                aria-label="Switch project"
                className="fx-switch-project"
                disabled={busy || creating}
                value={project?.id || ""}
                onChange={(e) => select(e.target.value).catch(message)}
              >
                {!project && <option value="">Choose project</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}
            {user && (
              <button
                aria-label="Create new workspace project"
                className="fx-quick-new"
                disabled={busy || creating}
                onClick={openNew}
              >
                <Plus size={14} />
              </button>
            )}
            Workspace
            <ChevronRight size={13} />
            <strong>{view}</strong>
          </div>
          <div className="fx-top-actions">
            <ThemeToggle />
            {!user && !loading && (
              <Link
                href="/sign-in"
                className="fx-mobile-login"
                onClick={rememberDraft}
              >
                Sign in
              </Link>
            )}
            {user && (
              <span className="fx-runtime-indicator">
                <i />
                {engineLabel}
              </span>
            )}
            <button
              className="fx-config"
              aria-label="Settings / API keys"
              title="API key settings"
              onClick={() => setModal("settings")}
            >
              <Settings2 size={14} />
              <span>Settings / API keys</span>
            </button>
            <button
              className="fx-menu"
              aria-label="Open workspace menu"
              onClick={() => setModal("menu")}
            >
              <Menu size={19} />
            </button>
          </div>
        </header>
        {view === "Agent" ? (
          <section className="fx-agent">
            <div className="fx-stage">
              <div className="fx-intro">
                <div className="fx-intro-copy">
                  <span className="fx-overline"><span className="fx-status-dot" /> ForgeAI / Build agent</span>
                  <h1><span><i>What will</i></span> <span><i>you build?</i></span></h1>
                  <p>Describe your app. Shape the plan, inspect the code and try the result in your workspace.</p>
                </div>
                <div className="fx-study">
                  <AssemblyDrawing />
                  <button className="fx-watch" ref={watchButton} type="button" aria-expanded={watching}
                    aria-controls="forge-guided-build" onClick={() => setWatching(!watching)}>
                    <span>{watching ? "Close example" : "Watch a build"}</span><span aria-hidden="true">{watching ? "−" : "↗"}</span>
                  </button>
                </div>
              </div>
              <div id="forge-guided-build" hidden={!watching}>
                {watching && <BuildDemo onUseBrief={applyIdea} onClose={() => { setWatching(false); watchButton.current?.focus(); }} />}
              </div>
              <div className="fx-dock">
                {composer}
                <div className="fx-dock-note">
                  <span>{project?.title || "New workspace"}</span>
                  <span>Ctrl / ⌘ + Enter to run</span>
                </div>
              </div>
              <div className="fx-suggestions">
                <div className="fx-label"><span>Starting points</span><button type="button" onClick={() => setModal("ideas")}>Prompt library <ArrowUpRight size={13}/></button></div>
                <div className="fx-idea-row">
                  {ideas.map(({ icon: Icon, title, detail, text }, i) => (
                    <button key={title} onClick={() => applyIdea(text)}>
                      <div>
                        <Icon size={19} />
                        <small>0{i + 1}</small>
                      </div>
                      <span>
                        {title}
                        <ArrowUpRight size={14} />
                      </span>
                      <p className="fx-idea-detail">{detail}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section
            className={
              "fx-sheet" + (view === "Workbench" ? " fx-workbench" : "")
            }
          >
            <div className="fx-sheet-heading">
              <span className="fx-overline">
                {project?.title || "YOUR WORKSPACE"}
              </span>
              <h1>
                {view === "Workbench"
                  ? "Files & preview"
                  : view === "Blueprint"
                    ? "Architecture blueprint"
                    : "Run history"}
              </h1>
            </div>
            {view === "Blueprint" ? (
              <>
                {busy && (
                  <div className="fx-run-panel">
                    <ForgeMark className="fx-active-mark" thinking />
                    <div>
                      <span className="fx-overline">LIVE SESSION</span>
                      <h2>
                        {phase === "Architect"
                          ? "Mapping your application"
                          : phase === "Data & API"
                            ? "Building your data and API"
                            : phase === "Interface"
                              ? "Building the interface"
                              : "Verifying the build"}
                      </h2>
                      <div className="fx-timeline">
                        {(
                          [
                            "Architect",
                            "Data & API",
                            "Interface",
                            "Verifier",
                          ] as const
                        ).map((s) => (
                          <span
                            key={s}
                            aria-current={s === phase ? "step" : undefined}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                      <p role="status">
                        {activity.at(-1) || "Reading your brief…"}
                      </p>
                      {phase !== "Architect" && (
                        <button onClick={() => navigate("Workbench")}>
                          Inspect live files <ArrowUpRight size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {plan ? (
                  <PlanCard plan={plan} />
                ) : !busy ? (
                  <div className="fx-empty">
                    <Boxes />
                    <h2>
                      {busy
                        ? "Planning your application"
                        : "Start with a blueprint"}
                    </h2>
                    <p>
                      Review the pages, endpoints and data models before
                      generating code.
                    </p>
                    <button
                      onClick={() => {
                        setMode("plan");
                        navigate("Agent");
                      }}
                    >
                      Write a brief <ArrowRight size={15} />
                    </button>
                  </div>
                ) : null}
                {plan && !busy && (
                  <button
                    className="fx-primary"
                    onClick={() => {
                      setPrompt(
                        "Build the application described in my saved blueprint.",
                      );
                      setMode("build");
                      navigate("Agent");
                    }}
                  >
                    Build from this plan <ArrowRight size={15} />
                  </button>
                )}
              </>
            ) : view === "History" ? (
              <div className="fx-history">
                {!!activity.length && (
                  <ol>
                    {activity.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ol>
                )}
                {project?.runs.map((r) => (
                  <details key={r.id}>
                    <summary>
                      <strong>{r.status}</strong>
                      {r.prompt}
                    </summary>
                    <p>{r.report}</p>
                  </details>
                ))}
                {!activity.length && !project?.runs.length && (
                  <div className="fx-empty">
                    <History />
                    <h2>No runs yet</h2>
                    <p>Your requests, repairs and build results appear here.</p>
                    <button onClick={() => navigate("Agent")}>
                      Open agent <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="fx-studio-grid">
                  <aside className="fx-studio-brief">
                    <span className="fx-overline">BUILD BRIEF</span>
                    <h2>What’s next?</h2>
                    {composer}
                    <button
                      className="fx-studio-templates"
                      onClick={() => setModal("ideas")}
                    >
                      <LayoutTemplate size={14} /> Starter templates
                    </button>
                    {plan && (
                      <details open>
                        <summary>Architecture blueprint</summary>
                        <PlanCard plan={plan} />
                      </details>
                    )}
                    <section className="fx-studio-progress">
                      <h3>Build activity</h3>
                      {activity.length ? (
                        <ol aria-live="polite">
                          {activity.slice(-12).map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ol>
                      ) : (
                        <p>
                          {project?.runs[0]?.report ||
                            "Run your brief to see build steps."}
                        </p>
                      )}
                    </section>
                  </aside>
                  <section className="fx-studio-output">
                    <div className="fx-studio-toolbar">
                      <select
                        aria-label="Preview viewport"
                        value={viewport}
                        onChange={(e) => {
                          setViewport(e.target.value);
                          setTab("Preview");
                        }}
                      >
                        {["Desktop", "Tablet", "Mobile"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                      <button
                        disabled={!project?.preview}
                        aria-pressed={inspect}
                        onClick={() => {
                          setTab("Preview");
                          setInspect(!inspect);
                        }}
                      >
                        Visual edit
                      </button>
                      {project && (
                        <ProjectActions
                          title={project.title}
                          files={savedFiles}
                          projectId={project.id}
                        />
                      )}
                    </div>
                    <div className="fx-inspector-head">
                      <div className="fx-tabs">
                        {(
                          ["Preview", "Code", "Data & API", "Terminal"] as Tab[]
                        ).map((t) => (
                          <button
                            key={t}
                            aria-pressed={t === tab}
                            onClick={() => setTab(t)}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      <span>REV {project?.revision || 0}</span>
                    </div>
                    <div className="fx-inspector">
                      {tab === "Code" ? (
                        <CodePane
                          key={project?.id}
                          files={files}
                          path={file}
                          onSelect={setFile}
                          projectId={project?.id}
                          revision={project?.revision}
                          locked={busy}
                          headers={keyHeaders}
                          onSaved={async () => {
                            if (project) {
                              await select(project.id);
                              setRefresh((r) => r + 1);
                              setNotice("Source saved and preview rebuilt.");
                            }
                          }}
                        />
                      ) : tab === "Data & API" ? (
                        project ? (
                          <DatabaseInspector
                            key={project.id + "-" + project.revision}
                            projectId={project.id}
                            revision={project.revision}
                            headers={keyHeaders}
                          />
                        ) : (
                          <p className="fx-empty">
                            Create a project to inspect its data.
                          </p>
                        )
                      ) : tab === "Terminal" ? (
                        <>
                          <pre ref={logBox}>
                            {logs || "No terminal output for this run."}
                          </pre>
                          {project && (
                            <details className="fx-terminal-audit">
                              <summary>Source security checks</summary>
                              {reviewSources(savedFiles).length ? (
                                reviewSources(savedFiles).map((f, i) => (
                                  <p key={i}>
                                    {f.level} · {f.check} · {f.path}:{f.line}
                                  </p>
                                ))
                              ) : (
                                <p>No matching issues in this revision.</p>
                              )}
                            </details>
                          )}
                        </>
                      ) : project?.preview ? (
                        <>
                          <div className="fx-preview-bar">
                            <span>{project.preview}</span>
                            <button
                              aria-label="Refresh preview"
                              onClick={() => setRefresh((r) => r + 1)}
                            >
                              <RefreshCw size={15} />
                            </button>
                          </div>
                          <VisualPreview
                            key={project.id + project.revision}
                            url={project.preview}
                            mobile={viewport === "Mobile"}
                            tablet={viewport === "Tablet"}
                            inspect={inspect}
                            onInspect={setInspect}
                            refresh={refresh}
                            onEdit={applyIdea}
                          />
                        </>
                      ) : (
                        <div className="fx-empty">
                          <Monitor />
                          <h2>No live preview yet</h2>
                          <p>Run a build to open your app here.</p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </>
            )}
            {busy && (
              <div className="fx-live">
                <Activity size={15} />
                Agent running
                <button onClick={() => abort.current?.abort()}>Stop</button>
              </div>
            )}
          </section>
        )}
      </section>
      {modal && (
        <Modal
          title={
            {
              settings: "Settings / API keys",
              new: "New project",
              menu: "Workspace",
              ideas: "Prompt library",
              search: "Find a project",
            }[modal]
          }
          close={() => setModal(null)}
        >
          {modal === "settings" ? (
            <ProviderSettings
              status={providerStatus}
              signedIn={!!user}
              locked={busy}
              headers={keyHeaders}
              runtime={engine}
              onSignIn={() => authenticate()}
              onSave={(h, status, r) => {
                setKeyHeaders(h);
                setProviderStatus(status);
                setModel(status.modelLabel);
                setCloud(status.providers.e2b);
                setEngine(r);
                setMissing(
                  status.provider &&
                    status.providers[
                      status.provider as keyof typeof status.providers
                    ]
                    ? []
                    : ["a model provider"],
                );
                setModal(null);
                setNotice("Settings applied.");
              }}
            />
          ) : modal === "new" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <label>
                Project name
                <input
                  autoFocus
                  required
                  minLength={2}
                  maxLength={80}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <button className="fx-primary" disabled={creating}>
                Create project
              </button>
            </form>
          ) : modal === "ideas" ? (
            <div className="fx-library-ideas">
              {ideas.map((i) => (
                <button key={i.title} onClick={() => applyIdea(i.text)}>
                  <strong>{i.title}</strong>
                  <span>{i.text}</span>
                </button>
              ))}
            </div>
          ) : modal === "search" ? (
            <>
              <label>
                Search projects
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {projectRows.length ? projectRows : <p>No matching projects.</p>}
            </>
          ) : (
            <>
              <div className="fx-mobile-nav">{nav()}</div>
              {newBtn}
              <div className="fx-mobile-projects">{projectRows}</div>
              {who}
            </>
          )}
        </Modal>
      )}
      {notice && (
        <div className="fx-toast" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}
    </main>
  );
}
