import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Sortable from "sortablejs";
import "../public/board.css";
import "../public/home.css";
import "../public/agents.css";

type AnyObj = Record<string, any>;

const TAB_KEY = "helmmate.activeTab";
const SIDEBAR_KEY = "helmmate.sidebarCollapsed";
const VIEWS = ["home", "board", "agents", "projects"] as const;
type View = (typeof VIEWS)[number];

const DEFAULT_COLUMNS = [
  { status: "triage", title: "Triage" },
  { status: "backlog", title: "Backlog" },
  { status: "queued", title: "Queued" },
  { status: "in_progress", title: "In Progress" },
  { status: "blocked", title: "Blocked" },
  { status: "human_review", title: "Human Review" },
  { status: "done", title: "Done" },
];

const CODEX_MODEL_BY_ROLE: AnyObj = {
  "ios-engineer": "gpt-5.4-mini",
  "backend-engineer": "gpt-5.4-mini",
  "cross-repo": "gpt-5.3-codex",
  architect: "gpt-5.5",
};
const CODEX_EFFORT_BY_ROLE: AnyObj = {
  "ios-engineer": "medium",
  "backend-engineer": "medium",
  "cross-repo": "high",
  architect: "high",
};
const CODEX_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"];
const CODEX_EFFORTS = ["low", "medium", "high", "xhigh"];
const OPENCODE_MODEL_BY_ROLE: AnyObj = {
  "ios-engineer": "opencode-go/minimax-m2.7",
  "backend-engineer": "opencode-go/minimax-m2.7",
  "cross-repo": "opencode-go/qwen3.7-plus",
  architect: "opencode-go/qwen3.7-max",
};
const OPENCODE_VARIANT_BY_ROLE: AnyObj = {
  "ios-engineer": null,
  "backend-engineer": null,
  "cross-repo": null,
  architect: null,
};
const OPENCODE_MODELS = [
  "opencode-go/minimax-m2.7",
  "opencode-go/minimax-m2.5",
  "opencode-go/minimax-m3",
  "opencode-go/qwen3.7-plus",
  "opencode-go/qwen3.7-max",
  "opencode-go/qwen3.6-plus",
  "opencode-go/kimi-k2.6",
  "opencode-go/kimi-k2.5",
  "opencode-go/deepseek-v4-pro",
  "opencode-go/deepseek-v4-flash",
  "opencode-go/glm-5.1",
  "opencode-go/glm-5",
  "opencode-go/mimo-v2.5-pro",
  "opencode-go/mimo-v2.5",
];
const OPENCODE_VARIANTS = ["minimal", "low", "medium", "high", "max"];

function engineLabel(engine: string) {
  if (engine === "claude") return "Claude";
  if (engine === "codex") return "Codex";
  if (engine === "opencode") return "OpenCode";
  return titleForStatus(engine);
}

function shortOpenCodeModel(model: string) {
  return String(model || "").replace(/^opencode-go\//, "");
}

function titleForStatus(status: string) {
  return String(status || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function getJSON(url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function patchTicket(id: string, patch: AnyObj) {
  const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data.error || `PATCH failed (${res.status})`);
    err.fieldErrors = data.fieldErrors || {};
    err.issues = data.issues || [];
    throw err;
  }
  return data;
}

async function postTicket(payload: AnyObj) {
  const res = await fetch("/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data.error || `Create failed (${res.status})`);
    err.fieldErrors = data.fieldErrors || {};
    err.issues = data.issues || [];
    throw err;
  }
  return data;
}

async function fetchLaunchPreview(id: string) {
  const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/launch-preview`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Preview failed (${res.status})`);
  return data;
}

function splitLines(value: string) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(items: any) {
  return Array.isArray(items) ? items.filter(Boolean).join("\n") : "";
}

function formatReviewerNote(note: string) {
  return `${new Date().toISOString()} — reviewer: ${String(note || "").trim()}`;
}

function validateTicketDraft(draft: AnyObj, validRepos: Set<string>, columns: AnyObj[]) {
  const errors: AnyObj = {};
  if (!draft.title) errors.title = "Title is required.";
  if (!draft.description) errors.description = "Description is required.";
  if (!validRepos.has(draft.repo)) errors.repo = "Choose a configured repo.";
  if (!["P0", "P1", "P2"].includes(draft.priority)) errors.priority = "Choose a valid priority.";
  if (!columns.some((item) => item.status === draft.status)) errors.status = "Choose a valid status.";
  if (draft.status !== "triage" && draft.acceptance_criteria.length === 0) {
    errors.acceptance_criteria = "Acceptance criteria are required before a ticket leaves triage.";
  }
  return errors;
}

function defaultTicketDraft(validRepos: Set<string>) {
  return {
    title: "",
    status: "triage",
    priority: "P2",
    repo: Array.from(validRepos)[0] || "workspace",
    description: "",
    acceptance_criteria: [],
    context_refs: [],
    notes: [],
    reviewer_note: "",
  };
}

function num(n: any) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(n);
}

function fmtInt(n: any) {
  const v = num(n);
  return v == null ? "-" : Math.round(v).toLocaleString("en-US");
}

function fmtTokens(n: any) {
  const v = num(n);
  if (v == null) return "-";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(v >= 10_000 ? 0 : 1) + "k";
  return String(Math.round(v));
}

function fmtPct(p: any) {
  const v = num(p);
  return v == null ? "-" : Math.round(v) + "%";
}

function fmtFractionPct(p: any) {
  const v = num(p);
  return v == null ? "-" : fmtPct(v * 100);
}

function fmtUSD(n: any, hasCost = true) {
  if (hasCost === false) return "-";
  const v = num(n);
  return v == null ? "-" : "$" + v.toFixed(v >= 100 ? 0 : 2);
}

function fmtMin(n: any) {
  const v = num(n);
  if (v == null) return "-";
  if (v < 1) return "<1m";
  if (v < 60) return Math.round(v) + "m";
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtDuration(startISO?: string, endISO?: string | null) {
  const s = startISO ? Date.parse(startISO) : NaN;
  const e = endISO ? Date.parse(endISO) : Date.now();
  if (Number.isNaN(s)) return "-";
  const secs = Math.max(0, Math.round((e - s) / 1000));
  if (secs < 60) return secs + "s";
  const m = Math.floor(secs / 60);
  const r = secs % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtClock(ms: any) {
  if (ms == null || Number.isNaN(ms)) return "-";
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function relTime(iso?: string) {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "-";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

function untilTime(iso?: string) {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "-";
  const diff = t - Date.now();
  return diff <= 0 ? "now" : fmtClock(diff);
}

function shortReason(reason: any) {
  const raw = String(reason || "").trim();
  if (!raw) return "Usage limit reached";
  const ticket = (raw.match(/(?:on|hit on)\s+([A-Za-z0-9._-]+)/i) || [])[1];
  if (/usage limit|session limit|rate limit|429/i.test(raw)) return ticket ? `Usage limit reached on ${ticket}` : "Usage limit reached";
  if (/autopilot off/i.test(raw)) return "Auto-dispatch is off";
  if (/disarmed/i.test(raw)) return "Board is disarmed";
  if (/night-only/i.test(raw)) return "Waiting for night window";
  if (/live usage .*unavailable|fail-safe/i.test(raw)) return "Live usage unavailable";
  if (/5h usage|weekly usage/i.test(raw)) return raw.replace(/\s+/g, " ").slice(0, 72);
  const clean = raw.replace(/\s+/g, " ");
  return clean.length > 78 ? clean.slice(0, 75) + "..." : clean;
}

function priorityPill(p: string) {
  const cls = p === "P0" ? "pill-p0" : p === "P1" ? "pill-p1" : "pill-p2";
  return <span className={`pill ${cls}`}>{p || "P2"}</span>;
}

function Gauge({ pct }: { pct: any }) {
  const v = num(pct);
  const w = v == null ? 0 : Math.max(0, Math.min(100, v));
  const danger = w >= 90 ? " home-bar--danger" : w >= 70 ? " home-bar--warn" : "";
  return (
    <div className={`home-bar${danger}`}>
      <div className="home-bar-fill" style={{ "--fill": String(w / 100) } as React.CSSProperties} />
    </div>
  );
}

function HomeCard({ title, sub, accentClass, children }: { title: string; sub?: string; accentClass?: string; children: React.ReactNode }) {
  return (
    <section className={`home-card${accentClass ? ` ${accentClass}` : ""}`}>
      <div className="home-card-head">
        <h3>{title}</h3>
        {sub ? <span className="home-card-sub">{sub}</span> : null}
      </div>
      <div className="home-card-body">{children}</div>
    </section>
  );
}

function MetricRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="home-kv">
      <span className="home-kv-k">{label}</span>
      <span className="home-kv-v">{children}</span>
    </div>
  );
}

function ShellIcon({ view }: { view: View }) {
  return <span className={`shell-icon shell-icon--${view}`} aria-hidden="true" />;
}

function setupRepoRows(setup: AnyObj | null) {
  if (!setup) return [];
  if (Array.isArray(setup.repoStatus) && setup.repoStatus.length) return setup.repoStatus;
  return (setup.repos || []).map((key: string) => ({ key, exists: null, path: "" }));
}

function slugProjectId(value: string) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "default";
}

function leafName(value: string) {
  return String(value || "")
    .trim()
    .replace(/\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .pop() || "";
}

function inferTicketPrefix(value: string) {
  const words = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const prefix = words.length > 1
    ? words.map((word) => word[0]).join("")
    : (words[0] || "DB").slice(0, 3);
  return (prefix || "DB").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || "DB";
}

function projectPayload(input: AnyObj) {
  return {
    name: input.name || input.id,
    workspaceDir: input.workspaceDir || ".",
    ticketsDir: "tickets",
    ticketIdPrefix: (input.ticketIdPrefix || "DB").toUpperCase(),
    repos: {
      workspace: {
        path: ".",
        baseBranch: "main",
        worktree: false,
        role: "cross-repo",
      },
    },
    statuses: DEFAULT_COLUMNS.map((item) => item.status),
    agentDir: ".agents",
    memoryQueueDir: "memory/sync-queue",
    workPrompt: "scripts/work-ticket-prompt.md",
    fixCiPrompt: "scripts/fix-ci-prompt.md",
    fixConflictPrompt: "scripts/fix-conflict-prompt.md",
    engines: {
      default: input.preferredEngine && input.preferredEngine !== "unknown" ? input.preferredEngine : "claude",
      allowed: ["claude", "codex", "opencode"],
    },
    roles: {
      "cross-repo": { model: "sonnet" },
      architect: { model: "opus" },
    },
    roleByRepo: { workspace: "cross-repo" },
  };
}

function App() {
  const [view, setViewState] = useState<View>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as View | null;
      return saved && VIEWS.includes(saved) ? saved : "home";
    } catch {
      return "home";
    }
  });
  const [config, setConfig] = useState<AnyObj | null>(null);
  const [setup, setSetup] = useState<AnyObj | null>(null);
  const [tickets, setTickets] = useState<AnyObj[]>([]);
  const [board, setBoard] = useState<AnyObj>({ armed: false, autopilot: false, wipLimit: 2, running: [], defaultEngine: "claude" });
  const [readyOnly, setReadyOnly] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [toast, setToastState] = useState("");
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [importingNotes, setImportingNotes] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const readinessEntryApplied = useRef(false);

  const columns = useMemo(() => {
    const statuses = Array.isArray(config?.statuses) && config.statuses.length ? config.statuses : DEFAULT_COLUMNS.map((c) => c.status);
    return statuses.map((status: string) => ({ status, title: titleForStatus(status) }));
  }, [config]);
  const validRepos = useMemo(() => new Set(Array.isArray(config?.repos) && config.repos.length ? config.repos : ["workspace"]), [config]);
  const engines = useMemo(() => (Array.isArray(config?.engines) && config.engines.length ? config.engines : ["claude", "codex", "opencode"]), [config]);
  const roleByRepo = useMemo(() => config?.roleByRepo || { workspace: "cross-repo" }, [config]);
  const roleModel = useMemo(() => {
    if (!config?.roles) return { "cross-repo": "sonnet", architect: "opus" };
    return Object.fromEntries(Object.entries(config.roles).map(([role, value]: any) => [role, value?.model || "sonnet"]));
  }, [config]);
  const byId = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);

  const showToast = useCallback((msg: string) => {
    setToastState(msg);
    window.clearTimeout((showToast as any).timer);
    (showToast as any).timer = window.setTimeout(() => setToastState(""), 3200);
  }, []);

  const loadConfig = useCallback(async () => setConfig(await getJSON("/api/config")), []);
  const loadSetup = useCallback(async () => setSetup(await getJSON("/api/setup/status")), []);
  const loadTickets = useCallback(async () => setTickets((await getJSON("/api/tickets")) || []), []);
  const loadBoardState = useCallback(async () => {
    const next = await getJSON("/api/state");
    if (next) setBoard(next);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadSetup(), loadTickets(), loadBoardState()]);
    setInitialLoadComplete(true);
  }, [loadConfig, loadSetup, loadTickets, loadBoardState]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!initialLoadComplete || readinessEntryApplied.current || !setup) return;
    readinessEntryApplied.current = true;
    if (!setup.projectConfigured || !setup.ready || tickets.length === 0) {
      setViewState("home");
    }
  }, [initialLoadComplete, setup, tickets.length]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const prev = (board.running || []).join(",");
      const next = await getJSON("/api/state");
      if (next) {
        setBoard(next);
        if ((next.running || []).join(",") !== prev) loadTickets();
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [board.running, loadTickets]);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  const boardDefaultEngine = useCallback(() => (engines.includes(board.defaultEngine) ? board.defaultEngine : "claude"), [engines, board.defaultEngine]);
  const resolveEngine = useCallback((t: AnyObj) => (t && engines.includes(t.engine) ? t.engine : boardDefaultEngine()), [engines, boardDefaultEngine]);
  const resolveRole = useCallback((t: AnyObj) => (t?.role && roleModel[t.role] ? t.role : roleByRepo[t?.repo] || "cross-repo"), [roleByRepo, roleModel]);
  const codexModel = useCallback((t: AnyObj) => (CODEX_MODELS.includes(t?.codex_model) ? t.codex_model : CODEX_MODEL_BY_ROLE[resolveRole(t)] || "gpt-5.4-mini"), [resolveRole]);
  const codexEffort = useCallback((t: AnyObj) => (CODEX_EFFORTS.includes(t?.codex_effort) ? t.codex_effort : CODEX_EFFORT_BY_ROLE[resolveRole(t)] || "medium"), [resolveRole]);
  const opencodeModel = useCallback((t: AnyObj) => (OPENCODE_MODELS.includes(t?.opencode_model) ? t.opencode_model : OPENCODE_MODEL_BY_ROLE[resolveRole(t)] || "opencode-go/minimax-m2.7"), [resolveRole]);
  const opencodeVariant = useCallback((t: AnyObj) => (OPENCODE_VARIANTS.includes(t?.opencode_variant) ? t.opencode_variant : OPENCODE_VARIANT_BY_ROLE[resolveRole(t)] || null), [resolveRole]);

  const depsUnmet = useCallback((ticket: AnyObj) => {
    const deps = Array.isArray(ticket.depends_on) ? ticket.depends_on : [];
    return deps.filter((id: string) => !byId.get(id) || byId.get(id).status !== "done");
  }, [byId]);
  const isSessionRunning = useCallback((id: string) => Array.isArray(board.running) && board.running.includes(id), [board.running]);
  const isQueued = useCallback((ticket: AnyObj) => ticket?.status === "queued" && !isSessionRunning(ticket.id), [isSessionRunning]);
  const isSessionPaused = useCallback((ticket: AnyObj) => !!ticket.last_run_limit_hit && ["in_progress", "backlog", "queued"].includes(ticket.status) && !isSessionRunning(ticket.id), [isSessionRunning]);
  const isBlocked = useCallback((ticket: AnyObj) => ticket.status === "blocked" || depsUnmet(ticket).length > 0, [depsUnmet]);
  const isReady = useCallback((ticket: AnyObj) => {
    if (!["triage", "backlog"].includes(ticket.status)) return false;
    if (isSessionRunning(ticket.id)) return false;
    if (depsUnmet(ticket).length > 0) return false;
    if (!validRepos.has(ticket.repo)) return false;
    if (ticket.status !== "triage" && (!Array.isArray(ticket.acceptance_criteria) || ticket.acceptance_criteria.length === 0)) return false;
    return true;
  }, [depsUnmet, isSessionRunning, validRepos]);

  const handleLaunchResult = useCallback((id: string, newStatus: string, result: AnyObj) => {
    if (newStatus === "in_progress" && result?.launch) {
      const r = result.launch;
      if (r.launched) showToast(`${id} launched (pid ${r.pid})`);
      else if (r.reason === "disarmed") showToast(`${id} queued - board is disarmed`);
      else if (r.reason === "blocked") showToast(`${id} blocked - deps not done`);
      else if (r.reason === "preflight_failed") showToast(`${id} blocked - preflight failed`);
      else if (r.reason === "wip_limit") showToast(`${id} queued - WIP limit reached`);
      else if (r.reason === "already_running") showToast(`${id} already running`);
      else showToast(`${id} not launched (${r.reason})`);
    } else {
      showToast(`${id} -> ${newStatus}`);
    }
  }, [showToast]);

  const moveTicket = useCallback(async (id: string, newStatus: string) => {
    const ticket = byId.get(id);
    const prevStatus = ticket?.status;
    if (!ticket || newStatus === prevStatus) return;
    setTickets((cur) => cur.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
    try {
      const result = await patchTicket(id, { status: newStatus });
      handleLaunchResult(id, newStatus, result);
    } catch (err: any) {
      showToast(err.message);
    }
    await Promise.all([loadTickets(), loadBoardState()]);
  }, [byId, handleLaunchResult, loadTickets, loadBoardState, showToast]);

  const createBoardStarterTicket = useCallback(async () => {
    setViewState("board");
    setOpenTicketId(null);
    setCreatingTicket(true);
    setImportingNotes(false);
  }, []);

  const openImportNotes = useCallback(() => {
    setViewState("board");
    setOpenTicketId(null);
    setCreatingTicket(false);
    setImportingNotes(true);
  }, []);

  const stopSession = useCallback(async (id: string) => {
    if (!confirm(`Stop the running session for ${id}? This kills the agent process and reverts the ticket to Backlog.`)) return;
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/stop`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.stopped) showToast(`${id} session stopped (pid ${data.pid})`);
      else showToast(`${id} not stopped - ${data.reason || res.status}`);
    } catch (err: any) {
      showToast(`stop failed: ${err.message}`);
    }
    await Promise.all([loadTickets(), loadBoardState()]);
  }, [loadTickets, loadBoardState, showToast]);

  const resumeSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/resume`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.launched) showToast(`${id} resumed (pid ${data.pid})`);
      else if (data.reason === "disarmed") showToast(`${id} not resumed - board is disarmed`);
      else if (data.reason === "wip_limit") showToast(`${id} not resumed - WIP limit reached`);
      else showToast(`${id} not resumed - ${data.reason || data.error || res.status}`);
    } catch (err: any) {
      showToast(`resume failed: ${err.message}`);
    }
    await Promise.all([loadTickets(), loadBoardState()]);
  }, [loadTickets, loadBoardState, showToast]);

  const setArmed = useCallback(async (armed: boolean) => {
    const res = await fetch("/api/arm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ armed }) });
    setBoard(await res.json());
  }, []);

  const setDefaultEngine = useCallback(async () => {
    const current = boardDefaultEngine();
    const next = engines[(engines.indexOf(current) + 1) % engines.length] || current;
    try {
      const res = await fetch("/api/engine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine: next }) });
      if (!res.ok) throw new Error(`engine set failed (${res.status})`);
      setBoard(await res.json());
      showToast(`Default engine -> ${engineLabel(next)}`);
    } catch (err: any) {
      showToast(err.message);
    }
  }, [boardDefaultEngine, engines, showToast]);

  const setView = useCallback((next: View) => {
    setViewState(VIEWS.includes(next) ? next : "board");
  }, []);

  const openTicket = openTicketId ? byId.get(openTicketId) : null;
  const readyCount = tickets.filter((ticket) => isReady(ticket)).length;
  const queuedCount = tickets.filter((ticket) => isQueued(ticket)).length;
  const runningCount = (board.running || []).length;
  const blockedCount = tickets.filter((ticket) => isBlocked(ticket)).length;

  return (
    <>
      <div className={`app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`}>
        <aside className="sidebar" aria-label="Primary navigation">
          <div className="sidebar-head">
            <div className="brand">
              <span className="brand-mark" />
              <span className="brand-name">HelmMate</span>
            </div>
            <button
              className="sidebar-toggle"
              type="button"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={sidebarCollapsed}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              <span className="sidebar-toggle-icon" aria-hidden="true" />
            </button>
          </div>
          <nav className="side-nav" role="tablist" aria-label="Views">
            {VIEWS.map((v) => (
              <button key={v} className={`side-tab${view === v ? " side-tab--active" : ""}`} type="button" role="tab" aria-selected={view === v} aria-label={titleForStatus(v)} title={titleForStatus(v)} onClick={() => setView(v)}>
                <ShellIcon view={v} />
                <span className="side-tab-label">{titleForStatus(v)}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="app-main">
          <header className="topbar">
            <div className="topbar-strip" aria-label="Launch controls">
              <div className="topbar-group topbar-group--status" aria-label="Board state">
                <div className="control-chip control-chip--metric" title="Current running sessions against the WIP limit">
                  <span className={`control-dot${runningCount ? " control-dot--live" : ""}`} />
                  <span className="control-label">WIP</span>
                  <strong>{runningCount}/{board.wipLimit || 2}</strong>
                </div>
                <button className={`control-chip control-chip--button${readyOnly ? " control-chip--on" : ""}`} type="button" aria-pressed={readyOnly} title="Show ready backlog tickets only" onClick={() => setReadyOnly((v) => !v)}>
                  <span className="control-label">Ready</span>
                  <strong>{readyCount}</strong>
                </button>
                <div className="control-chip control-chip--metric control-chip--muted" title="Queued launch requests waiting for permission, WIP, or scheduler">
                  <span className="control-label">Queued</span>
                  <strong>{queuedCount}</strong>
                </div>
                {blockedCount ? (
                  <div className="control-chip control-chip--metric control-chip--bad" title="Tickets blocked by status or dependencies">
                    <span className="control-label">Blocked</span>
                    <strong>{blockedCount}</strong>
                  </div>
                ) : null}
              </div>

              <div className="topbar-group topbar-group--actions" aria-label="Ticket actions">
                <button className="ghost-btn" type="button" title="Create a reviewed ticket from the board" onClick={createBoardStarterTicket}>Create ticket</button>
                <button className="ghost-btn" type="button" title="Copy an agent prompt that imports pasted notes into triage tickets" onClick={openImportNotes}>Import notes</button>
                <button className="ghost-btn ghost-btn--compact" type="button" title="Refresh board" onClick={refresh}>Refresh</button>
              </div>

              <div className="topbar-group topbar-group--launch" aria-label="Launch safety">
                <button className={`ghost-btn engine-toggle${boardDefaultEngine() === "codex" ? " engine-toggle--codex" : ""}${boardDefaultEngine() === "opencode" ? " engine-toggle--opencode" : ""}`} type="button" title="Cycle default engine for new launches: Claude, Codex, or OpenCode" onClick={setDefaultEngine}>
                  Engine <span className="engine-label">{engineLabel(boardDefaultEngine())}</span>
                </button>
                <button className={`arm ${board.armed ? "arm--on" : "arm--off"}`} type="button" aria-pressed={!!board.armed} onClick={() => setArmed(!board.armed)}>
                  <span className="arm-dot" />
                  <span className="arm-label">{board.armed ? "Armed" : "Disarmed"}</span>
                </button>
              </div>
            </div>
          </header>

          <section className="view view-home" hidden={view !== "home"} role="tabpanel">
            <HomeView active={view === "home"} setView={setView} />
          </section>
          <section className="view view-board" hidden={view !== "board"} role="tabpanel">
            <BoardView
              tickets={tickets}
              columns={columns}
              readyOnly={readyOnly}
              isReady={isReady}
              isBlocked={isBlocked}
              isSessionRunning={isSessionRunning}
              isQueued={isQueued}
              isSessionPaused={isSessionPaused}
              resolveRole={resolveRole}
              roleModel={roleModel}
              resolveEngine={resolveEngine}
              boardDefaultEngine={boardDefaultEngine}
              codexModel={codexModel}
              codexEffort={codexEffort}
              opencodeModel={opencodeModel}
              opencodeVariant={opencodeVariant}
              moveTicket={moveTicket}
              openTicket={setOpenTicketId}
              stopSession={stopSession}
              resumeSession={resumeSession}
              setView={setView}
              showToast={showToast}
            />
            {openTicket ? (
              <TicketPanel
                ticket={openTicket}
                columns={columns}
                validRepos={validRepos}
                engines={engines}
                byId={byId}
                roleModel={roleModel}
                resolveRole={resolveRole}
                resolveEngine={resolveEngine}
                boardDefaultEngine={boardDefaultEngine}
                codexModel={codexModel}
                codexEffort={codexEffort}
                opencodeModel={opencodeModel}
                opencodeVariant={opencodeVariant}
                isSessionRunning={isSessionRunning}
                isQueued={isQueued}
                isSessionPaused={isSessionPaused}
                moveTicket={moveTicket}
                close={() => setOpenTicketId(null)}
                refresh={async () => {
                  await Promise.all([loadTickets(), loadBoardState()]);
                }}
                showToast={showToast}
                stopSession={stopSession}
                resumeSession={resumeSession}
                handleLaunchResult={handleLaunchResult}
              />
            ) : null}
            {creatingTicket ? (
              <TicketFormPanel
                mode="create"
                ticket={defaultTicketDraft(validRepos)}
                columns={columns}
                validRepos={validRepos}
                close={() => setCreatingTicket(false)}
                refresh={async () => {
                  await Promise.all([loadTickets(), loadBoardState()]);
                }}
                afterSave={(id: string) => {
                  setCreatingTicket(false);
                  setOpenTicketId(id);
                }}
                showToast={showToast}
                handleLaunchResult={handleLaunchResult}
              />
            ) : null}
            {importingNotes ? (
              <ImportNotesPanel
                close={() => setImportingNotes(false)}
                showToast={showToast}
              />
            ) : null}
          </section>
          <section className="view view-agents" hidden={view !== "agents"} role="tabpanel">
            <AgentsView active={view === "agents"} />
          </section>
          <section className="view view-projects" hidden={view !== "projects"} role="tabpanel">
            <ProjectsView active={view === "projects"} refreshBoard={refresh} setView={setView} />
          </section>
        </div>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}

function BoardView(props: AnyObj) {
  const {
    tickets, columns, readyOnly, isReady, isBlocked, isSessionRunning, isQueued, isSessionPaused,
    resolveRole, roleModel, resolveEngine, boardDefaultEngine, codexModel, codexEffort, opencodeModel, opencodeVariant,
    moveTicket, openTicket, stopSession, resumeSession, setView, showToast,
  } = props;

  if (tickets.length === 0) {
    return (
      <main className="board board--empty">
        <BoardEmptyState
          setView={setView}
          showToast={showToast}
        />
      </main>
    );
  }

  return (
    <main className="board">
      {columns.map((col: AnyObj) => {
        const items = tickets
          .filter((t: AnyObj) => (t.status || "backlog") === col.status)
          .filter((t: AnyObj) => !readyOnly || col.status !== "backlog" || isReady(t))
          .sort((a: AnyObj, b: AnyObj) => String(a.id).localeCompare(String(b.id)));
        return (
          <BoardColumn key={col.status} col={col} items={items} moveTicket={moveTicket}>
            {items.length ? items.map((ticket: AnyObj) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                isReady={isReady}
                isBlocked={isBlocked}
                isSessionRunning={isSessionRunning}
                isQueued={isQueued}
                isSessionPaused={isSessionPaused}
                resolveRole={resolveRole}
                roleModel={roleModel}
                resolveEngine={resolveEngine}
                boardDefaultEngine={boardDefaultEngine}
                codexModel={codexModel}
                codexEffort={codexEffort}
                opencodeModel={opencodeModel}
                opencodeVariant={opencodeVariant}
                openTicket={openTicket}
                stopSession={stopSession}
                resumeSession={resumeSession}
              />
            )) : <ColumnEmptyHint status={col.status} tickets={tickets} readyOnly={readyOnly} />}
          </BoardColumn>
        );
      })}
    </main>
  );
}

function BoardEmptyState({ setView }: AnyObj) {
  return (
    <section className="board-empty" aria-label="Board empty state">
      <div className="board-empty-main">
        <span className="board-empty-kicker">Readiness first</span>
        <h1>Prepare the workspace before the board fills in.</h1>
        <p>
          Home shows the setup checks, repo state, and next safe action. Return here once
          HelmMate has a project and reviewed tickets to operate on.
        </p>
      </div>
      <div className="board-empty-actions">
        <button className="board-empty-btn board-empty-btn--primary" type="button" onClick={() => setView("home")}>Open Home Readiness</button>
        <button className="board-empty-btn" type="button" onClick={() => setView("projects")}>Open Projects</button>
      </div>
    </section>
  );
}

function ColumnEmptyHint({ status, tickets, readyOnly }: AnyObj) {
  if (!tickets.length) return null;
  if (readyOnly && status === "backlog") return <p className="column-empty-hint">No ready backlog tickets match the filter.</p>;
  const hints: AnyObj = {
    triage: "No new tickets waiting for review.",
    backlog: "No tickets ready to queue.",
    queued: "No launch requests waiting.",
    in_progress: "No agent sessions running.",
    blocked: "No blocked tickets.",
    human_review: "No handoffs waiting.",
    done: "Nothing completed yet.",
  };
  return hints[status] ? <p className="column-empty-hint">{hints[status]}</p> : null;
}

function BoardColumn({ col, items, moveTicket, children }: AnyObj) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const sortable = Sortable.create(ref.current, {
      group: "board",
      animation: 140,
      ghostClass: "sortable-ghost",
      dragClass: "sortable-drag",
      filter: ".card-stop, .card-resume, .column-empty-hint",
      preventOnFilter: false,
      onAdd: (evt) => {
        const id = (evt.item as HTMLElement).dataset.id;
        const newStatus = (evt.to as HTMLElement).dataset.status;
        if (id && newStatus) moveTicket(id, newStatus);
      },
    });
    return () => sortable.destroy();
  }, [moveTicket, col.status, items.length]);

  return (
    <section className="column">
      <div className="column-head">
        <span className="column-title">{col.title}</span>
        <span className="column-count">{items.length}</span>
      </div>
      <div className="column-body" data-status={col.status} ref={ref}>
        {children}
      </div>
    </section>
  );
}

function RoleTag({ ticket, resolveRole, roleModel, resolveEngine, codexModel, codexEffort, opencodeModel, opencodeVariant }: AnyObj) {
  const role = resolveRole(ticket);
  const derived = !ticket?.role;
  if (resolveEngine(ticket) === "opencode") {
    const model = opencodeModel(ticket);
    const variant = opencodeVariant(ticket);
    const modelSource = ticket?.opencode_model ? "ticket override" : "role default";
    const variantSource = ticket?.opencode_variant ? "ticket override" : "role default";
    const title = `agent: ${role}${derived ? " (derived from repo)" : " (explicit)"} · opencode model: ${model} (${modelSource})${variant ? ` · variant: ${variant} (${variantSource})` : ""}`;
    return <span className="tag tag-role tag-role--opencode" title={title}>{role} · {shortOpenCodeModel(model)}{variant ? `/${variant}` : ""}</span>;
  }
  if (resolveEngine(ticket) === "codex") {
    const model = codexModel(ticket);
    const effort = codexEffort(ticket);
    const modelSource = ticket?.codex_model ? "ticket override" : "role default";
    const effortSource = ticket?.codex_effort ? "ticket override" : "role default";
    const title = `agent: ${role}${derived ? " (derived from repo)" : " (explicit)"} · codex model: ${model} (${modelSource}) · effort: ${effort} (${effortSource})`;
    return <span className="tag tag-role tag-role--codex" title={title}>{role} · {String(model).replace(/^gpt-/, "")}/{effort}</span>;
  }
  const model = ticket?.model || roleModel[role] || "sonnet";
  const opus = /opus/i.test(model);
  return <span className={`tag tag-role${opus ? " tag-role--opus" : ""}`} title={`agent: ${role} · model: ${model}${derived ? " (derived from repo)" : " (explicit)"}`}>{role}{opus ? " · opus" : ""}</span>;
}

function EngineTag({ ticket, resolveEngine, boardDefaultEngine }: AnyObj) {
  const engine = resolveEngine(ticket);
  if (engine === "claude" && engine === boardDefaultEngine()) return null;
  const pinned = !!ticket?.engine;
  return <span className={`tag tag-engine tag-engine--${engine}`} title={`engine: ${engine}${pinned ? " (pinned on ticket)" : " (board default)"}`}>{engine}</span>;
}

function TicketCard(props: AnyObj) {
  const { ticket, isReady, isBlocked, isSessionRunning, isQueued, isSessionPaused, openTicket, stopSession, resumeSession } = props;
  const blocked = isBlocked(ticket);
  const ready = isReady(ticket);
  const running = isSessionRunning(ticket.id);
  const queued = isQueued(ticket);
  const paused = isSessionPaused(ticket);
  return (
    <div
      className={`card${blocked ? " blocked" : ""}${running ? " running" : ""}${queued ? " queued" : ""}${paused ? " paused" : ""}`}
      data-id={ticket.id}
      role="button"
      tabIndex={0}
      aria-label={`Open ticket ${ticket.id}: ${ticket.title || "Untitled ticket"}`}
      onClick={() => openTicket(ticket.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openTicket(ticket.id);
        }
      }}
    >
      <div className="card-top">
        <span className="card-id">{ticket.id}</span>
        {priorityPill(ticket.priority)}
        {blocked ? <span className="badge-blocked">blocked</span> : null}
        {ready ? <span className="badge-ready">ready</span> : null}
        {queued ? <span className="badge-queued">queued</span> : null}
        {running ? <span className="badge-running">● running</span> : null}
        {paused ? <span className="badge-paused">⏸ paused</span> : null}
      </div>
      <p className="card-title">{ticket.title}</p>
      <div className="card-meta">
        {ticket.origin ? <span className="tag tag-origin" title={`spawned from ${ticket.origin}`}>↳ {ticket.origin}</span> : null}
        {ticket.epic ? <span className="tag">{ticket.epic}</span> : null}
        {ticket.repo ? <span className="tag tag-repo">{ticket.repo}</span> : null}
        <RoleTag ticket={ticket} {...props} />
        <EngineTag ticket={ticket} {...props} />
      </div>
      {running ? <button className="card-stop" type="button" title="Stop this session" onClick={(e) => { e.stopPropagation(); stopSession(ticket.id); }}>■ Stop session</button> : null}
      {paused ? <button className="card-resume" type="button" title="Resume from where the session left off" onClick={(e) => { e.stopPropagation(); resumeSession(ticket.id); }}>▶ Resume</button> : null}
    </div>
  );
}

function queuedExplanation(ticket: AnyObj) {
  if (ticket.queued_reason === "disarmed") {
    return {
      title: "Queued - board disarmed",
      body: "This ticket has a launch request, but HelmMate will not start an agent until the board is armed. Arm the board to launch it when a WIP slot is free.",
    };
  }
  if (ticket.queued_reason === "wip_limit") {
    return {
      title: "Queued - WIP limit reached",
      body: "This ticket has a launch request and will start automatically when a running session finishes and a WIP slot is free.",
    };
  }
  return {
    title: "Queued",
    body: "This ticket has a launch request but no agent session exists yet. Move it to Backlog to cancel, or to In Progress to retry launch now.",
  };
}

function launchPreviewText(p: AnyObj) {
  if (!p) return "";
  const effort = p.effort ? `${p.effort.name} (${p.effort.source})` : "n/a";
  const variant = p.variant ? `${p.variant.name || "none"} (${p.variant.source})` : "n/a";
  const worktree = p.worktree || {};
  const prompt = p.promptFile || {};
  const role = p.role || {};
  const command = p.command || {};
  const blockers = Array.isArray(p.blockers) && p.blockers.length
    ? p.blockers.map((item: AnyObj) => `- ${item.message || item.code}`).join("\n")
    : "- none";
  const warnings = Array.isArray(p.warnings) && p.warnings.length
    ? p.warnings.map((item: AnyObj) => `- ${item.message || item.code}`).join("\n")
    : "- none";

  return [
    `Launch preview for ${p.ticketId}`,
    `generated: ${p.generatedAt}`,
    `read only: ${p.readOnly ? "yes" : "no"}`,
    `will spawn agent: ${p.willSpawnAgent ? "yes" : "no"}`,
    `engine: ${p.engine?.name || "unknown"} (${p.engine?.source || "unknown"})`,
    `model: ${p.model?.name || "unknown"} (${p.model?.source || "unknown"})`,
    `effort: ${effort}`,
    `variant: ${variant}`,
    `role: ${role.name || "unknown"} (${role.mode || "unknown"})`,
    `persona: ${role.personaPath || "unknown"} (${role.personaExists ? "exists" : "missing"})`,
    `command: ${command.summary || "unknown"}`,
    `cwd: ${p.cwd || "unknown"}`,
    `branch: ${p.branch || "unknown"}`,
    `worktree: ${worktree.mode || "unknown"} at ${worktree.path || "unknown"}`,
    `prompt file: ${prompt.ref || "unknown"} -> ${prompt.path || "unknown"} (${prompt.exists ? "exists" : "missing"})`,
    `expected handoff status: ${p.expectedHandoffStatus || "unknown"}`,
    "blockers:",
    blockers,
    "warnings:",
    warnings,
  ].join("\n");
}

function LaunchPreviewSection({ ticketId, showToast }: { ticketId: string; showToast: (msg: string) => void }) {
  const [preview, setPreview] = useState<AnyObj | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPreview(await fetchLaunchPreview(ticketId));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  async function copy() {
    if (!preview) {
      showToast("Preview is not loaded yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(launchPreviewText(preview));
      showToast("Launch preview copied");
    } catch (err: any) {
      showToast(`Could not copy preview: ${err.message}`);
    }
  }

  const role = preview?.role || {};
  const worktree = preview?.worktree || {};
  const prompt = preview?.promptFile || {};
  const command = preview?.command || {};
  const effort = preview?.effort ? `${preview.effort.name} (${preview.effort.source})` : "n/a";
  const variant = preview?.variant ? `${preview.variant.name || "none"} (${preview.variant.source})` : "n/a";

  return (
    <div className="panel-section launch-preview-section">
      <div className="panel-section-head">
        <h3>Launch preview</h3>
        <div className="panel-section-actions">
          <button className="ghost-btn launch-preview-btn" type="button" onClick={load} disabled={loading}>Refresh</button>
          <button className="ghost-btn launch-preview-btn" type="button" onClick={copy} disabled={!preview}>Copy</button>
        </div>
      </div>
      <div className="launch-preview-content">
        {loading && !preview ? <p className="panel-desc">Loading preview...</p> : null}
        {error ? <p className="field-error">{error}</p> : null}
        {preview ? (
          <>
            <div className="kv launch-preview-kv"><span className="kv-key">engine</span><span className="kv-val">{preview.engine?.name || "unknown"} ({preview.engine?.source || "unknown"})</span></div>
            <div className="kv launch-preview-kv"><span className="kv-key">model</span><span className="kv-val">{preview.model?.name || "unknown"} ({preview.model?.source || "unknown"})</span></div>
            <div className="kv launch-preview-kv"><span className="kv-key">effort</span><span className="kv-val">{effort}</span></div>
            <div className="kv launch-preview-kv"><span className="kv-key">variant</span><span className="kv-val">{variant}</span></div>
            <div className="kv launch-preview-kv"><span className="kv-key">role</span><span className="kv-val">{role.name || "unknown"} ({role.mode || "unknown"})</span></div>
            <div className="kv launch-preview-kv"><span className="kv-key">persona</span><span className="kv-val">{role.personaPath || "unknown"} ({role.personaExists ? "exists" : "missing"})</span></div>
            <div className="kv launch-preview-kv"><span className="kv-key">cwd</span><span className="kv-val">{preview.cwd || "-"}</span></div>
            <div className="kv launch-preview-kv"><span className="kv-key">branch</span><span className="kv-val">{preview.branch || "-"}</span></div>
            <div className="kv launch-preview-kv"><span className="kv-key">worktree</span><span className="kv-val">{worktree.mode || "unknown"} · {worktree.path || "unknown"}</span></div>
            <div className="kv launch-preview-kv"><span className="kv-key">prompt file</span><span className="kv-val">{prompt.ref || "unknown"} ({prompt.exists ? "exists" : "missing"})</span></div>
            <div className="kv launch-preview-kv"><span className="kv-key">handoff</span><span className="kv-val">{preview.expectedHandoffStatus || "unknown"}</span></div>
            <div className="launch-preview-command">{command.summary || "command unavailable"}</div>
            <div className="launch-preview-grid">
              <LaunchPreviewIssues title="Blockers" items={preview.blockers} empty="None" />
              <LaunchPreviewIssues title="Warnings" items={preview.warnings} empty="None" />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function LaunchPreviewIssues({ title, items, empty }: { title: string; items: AnyObj[]; empty: string }) {
  return (
    <div>
      <h4>{title}</h4>
      {Array.isArray(items) && items.length ? (
        <ul className="launch-preview-issues">
          {items.map((item: AnyObj, idx: number) => (
            <li key={`${item.code || "issue"}-${idx}`} className={`launch-preview-issue launch-preview-issue--${item.level || "warning"}`}>
              {item.message || item.code || "issue"}
            </li>
          ))}
        </ul>
      ) : <p className="panel-desc">{empty}</p>}
    </div>
  );
}

function TicketPanel(props: AnyObj) {
  const {
    ticket, columns, validRepos, engines, byId, resolveRole, resolveEngine, boardDefaultEngine, codexModel,
    codexEffort, opencodeModel, opencodeVariant, isSessionRunning, isQueued, isSessionPaused, moveTicket, close, refresh, showToast,
    handleLaunchResult,
    stopSession, resumeSession,
  } = props;
  const [log, setLog] = useState("loading...");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    async function fetchLog() {
      try {
        const res = await fetch(`/api/tickets/${encodeURIComponent(ticket.id)}/log`);
        const text = await res.text();
        if (alive) setLog(text.trim() ? text : "No log output yet.");
      } catch {
        /* transient */
      }
    }
    fetchLog();
    const timer = window.setInterval(fetchLog, 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [ticket.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  async function savePatch(patch: AnyObj, success: string) {
    try {
      await patchTicket(ticket.id, patch);
      showToast(success);
      await refresh();
    } catch (err: any) {
      showToast(err.message);
    }
  }

  const deps = Array.isArray(ticket.depends_on) ? ticket.depends_on : [];
  const refs = Array.isArray(ticket.context_refs) ? ticket.context_refs : [];
  const ac = Array.isArray(ticket.acceptance_criteria) ? ticket.acceptance_criteria : [];
  const latestNote = Array.isArray(ticket.notes) && ticket.notes.length ? ticket.notes[ticket.notes.length - 1] : null;
  const running = isSessionRunning(ticket.id);
  const queued = isQueued(ticket);
  const queuedInfo = queued ? queuedExplanation(ticket) : null;
  const paused = isSessionPaused(ticket);

  if (editing) {
    return (
      <TicketFormPanel
        mode="edit"
        ticket={ticket}
        columns={columns}
        validRepos={validRepos}
        close={() => setEditing(false)}
        refresh={refresh}
        afterSave={() => setEditing(false)}
        showToast={showToast}
        handleLaunchResult={handleLaunchResult}
      />
    );
  }

  return (
    <>
      <div className="panel-overlay" onClick={close} />
      <aside className="panel" aria-hidden="false">
        <button className="panel-close" type="button" aria-label="Close" onClick={close}>&times;</button>
        <div className="panel-body">
          <span className="panel-id">{ticket.id} &middot; {ticket.status}{ticket.origin ? ` · ↳ from ${ticket.origin}` : ""}</span>
          <h2>{ticket.title}</h2>
          <div className="panel-actions">
            <button className="primary-btn" type="button" onClick={() => setEditing(true)}>Edit</button>
          </div>
          <div className="card-meta" style={{ marginTop: 8 }}>
            {priorityPill(ticket.priority)}
            {ticket.origin ? <span className="tag tag-origin">↳ {ticket.origin}</span> : null}
            {ticket.epic ? <span className="tag">{ticket.epic}</span> : null}
            {ticket.repo ? <span className="tag tag-repo">{ticket.repo}</span> : null}
            <RoleTag ticket={ticket} {...props} />
            <EngineTag ticket={ticket} {...props} />
            {ticket.size ? <span className="tag">size {ticket.size}</span> : null}
          </div>

          <PanelSection title="Move to">
            <select className="panel-move" value={ticket.status} onChange={(e) => moveTicket(ticket.id, e.target.value)}>
              {columns.map((c: AnyObj) => <option key={c.status} value={c.status}>{c.title}</option>)}
            </select>
          </PanelSection>

          <PanelSection title="Engine">
            <select className="panel-move" value={engines.includes(ticket.engine) ? ticket.engine : ""} onChange={(e) => savePatch({ engine: e.target.value || null }, e.target.value ? `${ticket.id} engine -> ${e.target.value}` : `${ticket.id} engine -> board default`)}>
              <option value="">Board default ({engineLabel(boardDefaultEngine())})</option>
              {engines.map((engine: string) => <option key={engine} value={engine}>{engineLabel(engine)}</option>)}
            </select>
            <p className="panel-hint">Codex uses your ChatGPT plan. OpenCode uses your OpenCode Go models.</p>
          </PanelSection>

          <PanelSection title="Codex routing">
            <div className="kv"><span className="kv-key">resolved</span><span className="kv-val">{codexModel(ticket)} · {codexEffort(ticket)}</span></div>
            <label className="panel-label">Model</label>
            <select className="panel-move" value={CODEX_MODELS.includes(ticket.codex_model) ? ticket.codex_model : ""} onChange={(e) => savePatch({ codex_model: e.target.value || null }, e.target.value ? `${ticket.id} Codex model -> ${e.target.value}` : `${ticket.id} Codex model -> role default`)}>
              <option value="">Role default ({CODEX_MODEL_BY_ROLE[resolveRole(ticket)] || "gpt-5.4-mini"})</option>
              {CODEX_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <label className="panel-label">Reasoning effort</label>
            <select className="panel-move" value={CODEX_EFFORTS.includes(ticket.codex_effort) ? ticket.codex_effort : ""} onChange={(e) => savePatch({ codex_effort: e.target.value || null }, e.target.value ? `${ticket.id} Codex effort -> ${e.target.value}` : `${ticket.id} Codex effort -> role default`)}>
              <option value="">Role default ({CODEX_EFFORT_BY_ROLE[resolveRole(ticket)] || "medium"})</option>
              {CODEX_EFFORTS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <p className="panel-hint">Used only when this ticket resolves to Codex. Empty means role default, not global config default.</p>
          </PanelSection>

          <PanelSection title="OpenCode routing">
            <div className="kv"><span className="kv-key">resolved</span><span className="kv-val">{opencodeModel(ticket)}{opencodeVariant(ticket) ? ` · ${opencodeVariant(ticket)}` : ""}</span></div>
            <label className="panel-label">Go model</label>
            <select className="panel-move" value={OPENCODE_MODELS.includes(ticket.opencode_model) ? ticket.opencode_model : ""} onChange={(e) => savePatch({ opencode_model: e.target.value || null }, e.target.value ? `${ticket.id} OpenCode model -> ${e.target.value}` : `${ticket.id} OpenCode model -> role default`)}>
              <option value="">Role default ({OPENCODE_MODEL_BY_ROLE[resolveRole(ticket)] || "opencode-go/minimax-m2.7"})</option>
              {OPENCODE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <label className="panel-label">Variant</label>
            <select className="panel-move" value={OPENCODE_VARIANTS.includes(ticket.opencode_variant) ? ticket.opencode_variant : ""} onChange={(e) => savePatch({ opencode_variant: e.target.value || null }, e.target.value ? `${ticket.id} OpenCode variant -> ${e.target.value}` : `${ticket.id} OpenCode variant -> role default`)}>
              <option value="">Role default ({OPENCODE_VARIANT_BY_ROLE[resolveRole(ticket)] || "none"})</option>
              {OPENCODE_VARIANTS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <p className="panel-hint">Used only when this ticket resolves to OpenCode. Empty means role default and usually sends no --variant.</p>
          </PanelSection>

          <LaunchPreviewSection ticketId={ticket.id} showToast={showToast} />

          {running ? (
            <PanelSection title="Session">
              <button className="stop-btn" type="button" onClick={() => stopSession(ticket.id)}>■ Stop session</button>
              <p className="panel-hint">Kills the agent process working this ticket and reverts it to Backlog.</p>
            </PanelSection>
          ) : paused ? (
            <div className="panel-section resume-section">
              <h3>Session paused - usage limit hit</h3>
              <p className="panel-hint">The worktree and branch are preserved. Resume to continue from exactly where the session left off.</p>
              <button className="resume-btn" type="button" onClick={() => resumeSession(ticket.id)}>▶ Resume session</button>
            </div>
          ) : null}

          {queuedInfo ? (
            <div className="panel-section queued-section">
              <h3>{queuedInfo.title}</h3>
              <p className="panel-hint">{queuedInfo.body}</p>
              {ticket.queued_detail ? <p className="panel-desc">{ticket.queued_detail}</p> : null}
            </div>
          ) : null}

          <PanelSection title="Description"><p className="panel-desc">{ticket.description}</p></PanelSection>
          {ticket.status === "blocked" && latestNote ? <PanelSection title="Latest blocker"><p className="panel-desc">{latestNote}</p></PanelSection> : null}
          {Array.isArray(ticket.notes) && ticket.notes.length ? <PanelSection title="Reviewer notes"><ul className="note-list">{ticket.notes.map((note: string) => <li key={note}>{note}</li>)}</ul></PanelSection> : null}
          {ac.length ? <PanelSection title="Acceptance criteria"><ul className="ac-list">{ac.map((c: string) => <li key={c}><span className="ac-box" /><span>{c}</span></li>)}</ul></PanelSection> : null}
          <PanelSection title="Depends on">
            {deps.length ? <div className="chip-row">{deps.map((id: string) => {
              const dep = byId.get(id);
              const cls = !dep ? "" : dep.status === "done" ? "done" : "pending";
              return <span key={id} className={`chip ${cls}`}>{id}{dep ? "" : " ?"}</span>;
            })}</div> : <p className="panel-desc">None</p>}
          </PanelSection>
          <PanelSection title="Branch & PR">
            <div className="kv"><span className="kv-key">branch</span><span className="kv-val">{ticket.branch || "-"}</span></div>
            <div className="kv"><span className="kv-key">pr</span><span className="kv-val">{ticket.pr_url ? <a href={ticket.pr_url} target="_blank" rel="noreferrer">{ticket.pr_url}</a> : "-"}</span></div>
          </PanelSection>
          {refs.length ? <PanelSection title="Context refs"><ul className="ref-list">{refs.map((r: string) => <li key={r}>{r}</li>)}</ul></PanelSection> : null}
          <PanelSection title="Live log"><div className="log-view">{log}</div></PanelSection>
        </div>
      </aside>
    </>
  );
}

function FieldError({ errors, field }: { errors: AnyObj; field: string }) {
  return errors?.[field] ? <p className="field-error">{errors[field]}</p> : null;
}

function TicketFormPanel({ mode, ticket, columns, validRepos, close, refresh, afterSave, showToast, handleLaunchResult }: AnyObj) {
  const isCreate = mode === "create";
  const [draft, setDraft] = useState<AnyObj>(() => ({
    title: ticket.title || "",
    priority: ticket.priority || "P2",
    status: ticket.status || "triage",
    repo: ticket.repo || Array.from(validRepos)[0] || "workspace",
    description: ticket.description || "",
    acceptance_criteria: Array.isArray(ticket.acceptance_criteria) ? ticket.acceptance_criteria : [],
    context_refs: Array.isArray(ticket.context_refs) ? ticket.context_refs : [],
    notes: Array.isArray(ticket.notes) ? ticket.notes : [],
    reviewer_note: "",
  }));
  const [criteriaText, setCriteriaText] = useState(() => joinLines(ticket.acceptance_criteria));
  const [contextText, setContextText] = useState(() => joinLines(ticket.context_refs));
  const [errors, setErrors] = useState<AnyObj>({});
  const statusChoices = isCreate ? columns.filter((c: AnyObj) => ["triage", "backlog"].includes(c.status)) : columns;

  function setField(field: string, value: any) {
    setDraft((cur) => ({ ...cur, [field]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const normalized = {
      ...draft,
      title: String(draft.title || "").trim(),
      description: String(draft.description || "").trim(),
      acceptance_criteria: splitLines(criteriaText),
      context_refs: splitLines(contextText),
      reviewer_note: String(draft.reviewer_note || "").trim(),
    };
    const nextErrors = validateTicketDraft(normalized, validRepos, columns);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setDraft(normalized);
      return;
    }

    const payload: AnyObj = {
      title: normalized.title,
      priority: normalized.priority,
      status: normalized.status,
      repo: normalized.repo,
      description: normalized.description,
      acceptance_criteria: normalized.acceptance_criteria,
      context_refs: normalized.context_refs,
    };
    if (normalized.reviewer_note) payload.notes = [...normalized.notes, formatReviewerNote(normalized.reviewer_note)];

    try {
      if (isCreate) {
        const result = await postTicket(payload);
        showToast(`${result.ticket.id} created`);
        await refresh();
        afterSave(result.ticket.id);
      } else {
        const result = await patchTicket(ticket.id, payload);
        if (normalized.status === "in_progress" && ticket.status !== "in_progress" && handleLaunchResult) {
          handleLaunchResult(ticket.id, normalized.status, result);
        } else {
          showToast(`${ticket.id} saved`);
        }
        await refresh();
        afterSave(ticket.id);
      }
    } catch (err: any) {
      setErrors(err.fieldErrors && Object.keys(err.fieldErrors).length ? err.fieldErrors : { form: err.message });
    }
  }

  return (
    <>
      <div className="panel-overlay" onClick={close} />
      <aside className="panel" aria-hidden="false">
        <button className="panel-close" type="button" aria-label="Close" onClick={close}>&times;</button>
        <div className="panel-body">
          <span className="panel-id">{isCreate ? "New ticket" : `${ticket.id} · ${ticket.status}`}</span>
          <h2>{isCreate ? "Create ticket" : "Edit ticket"}</h2>
          <FieldError errors={errors} field="form" />
          <form className="ticket-form" onSubmit={save} noValidate>
            <div className="panel-section">
              <label className="panel-label" htmlFor="ticket-title">Title</label>
              <input className="panel-input" id="ticket-title" type="text" value={draft.title} onChange={(e) => setField("title", e.target.value)} autoComplete="off" />
              <FieldError errors={errors} field="title" />
            </div>

            <div className="ticket-form-grid">
              <div>
                <label className="panel-label" htmlFor="ticket-priority">Priority</label>
                <select className="panel-move" id="ticket-priority" value={draft.priority} onChange={(e) => setField("priority", e.target.value)}>
                  {["P0", "P1", "P2"].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <FieldError errors={errors} field="priority" />
              </div>
              <div>
                <label className="panel-label" htmlFor="ticket-status">Status</label>
                <select className="panel-move" id="ticket-status" value={draft.status} onChange={(e) => setField("status", e.target.value)}>
                  {statusChoices.map((c: AnyObj) => <option key={c.status} value={c.status}>{c.title}</option>)}
                </select>
                <FieldError errors={errors} field="status" />
              </div>
            </div>

            <div className="panel-section">
              <label className="panel-label" htmlFor="ticket-repo">Repo</label>
              <select className="panel-move" id="ticket-repo" value={draft.repo} onChange={(e) => setField("repo", e.target.value)}>
                {Array.from(validRepos).map((repo: string) => <option key={repo} value={repo}>{repo}</option>)}
              </select>
              <FieldError errors={errors} field="repo" />
            </div>

            <div className="panel-section">
              <label className="panel-label" htmlFor="ticket-description">Description</label>
              <textarea className="panel-textarea" id="ticket-description" rows={6} value={draft.description} onChange={(e) => setField("description", e.target.value)} />
              <FieldError errors={errors} field="description" />
            </div>

            <div className="panel-section">
              <label className="panel-label" htmlFor="ticket-acceptance">Acceptance criteria</label>
              <textarea className="panel-textarea" id="ticket-acceptance" rows={5} placeholder="One criterion per line" value={criteriaText} onChange={(e) => setCriteriaText(e.target.value)} />
              <FieldError errors={errors} field="acceptance_criteria" />
            </div>

            <div className="panel-section">
              <label className="panel-label" htmlFor="ticket-context">Context refs</label>
              <textarea className="panel-textarea" id="ticket-context" rows={4} placeholder="One file, URL, or note ref per line" value={contextText} onChange={(e) => setContextText(e.target.value)} />
              <FieldError errors={errors} field="context_refs" />
            </div>

            <div className="panel-section">
              <label className="panel-label" htmlFor="ticket-reviewer-note">Add reviewer note</label>
              <textarea className="panel-textarea" id="ticket-reviewer-note" rows={3} value={draft.reviewer_note} onChange={(e) => setField("reviewer_note", e.target.value)} />
              <FieldError errors={errors} field="notes" />
            </div>

            <div className="panel-form-actions">
              <button className="primary-btn" type="submit">{isCreate ? "Create ticket" : "Save changes"}</button>
              <button className="ghost-btn" type="button" onClick={close}>Cancel</button>
            </div>
          </form>
        </div>
      </aside>
    </>
  );
}

function ImportNotesPanel({ close, showToast }: { close: () => void; showToast: (msg: string) => void }) {
  const [notes, setNotes] = useState("");
  const [contextRefs, setContextRefs] = useState("");
  const [createImmediately, setCreateImmediately] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [errors, setErrors] = useState<AnyObj>({});
  const [busy, setBusy] = useState(false);

  async function generate(copy = false) {
    const cleanNotes = notes.trim();
    if (!cleanNotes) {
      setPrompt("");
      setErrors({ notes: "Paste notes before generating a prompt." });
      return;
    }
    setBusy(true);
    setErrors({});
    setPrompt("");
    try {
      const res = await fetch("/api/import/notes-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: cleanNotes, contextRefs, createImmediately }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Prompt failed (${res.status})`);
      const nextPrompt = data.prompt || "";
      setPrompt(nextPrompt);
      if (copy) {
        await navigator.clipboard.writeText(nextPrompt);
        showToast("Import prompt copied");
      } else {
        showToast("Import prompt generated");
      }
    } catch (err: any) {
      setErrors({ form: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    if (!prompt) return generate(true);
    try {
      await navigator.clipboard.writeText(prompt);
      showToast("Import prompt copied");
    } catch (err: any) {
      showToast(`Could not copy import prompt: ${err.message}`);
    }
  }

  return (
    <>
      <div className="panel-overlay" onClick={close} />
      <aside className="panel" aria-hidden="false">
        <button className="panel-close" type="button" aria-label="Close" onClick={close}>&times;</button>
        <div className="panel-body">
          <span className="panel-id">Import</span>
          <h2>Import from notes</h2>
          <FieldError errors={errors} field="form" />
          <div className="panel-section import-intro">
            <p className="panel-desc">
              Paste rough notes and copy a handoff prompt for Claude Code, Codex, or opencode. The agent uses helm-create-ticket and writes triage tickets that you can review on the Board.
            </p>
          </div>

          <form className="ticket-form" onSubmit={(e) => { e.preventDefault(); generate(false); }} noValidate>
            <div className="panel-section">
              <label className="panel-label" htmlFor="import-notes-text">Notes</label>
              <textarea
                className="panel-textarea import-notes-textarea"
                id="import-notes-text"
                rows={10}
                placeholder="Paste roadmap notes, TODOs, bug reports, or open loops"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <FieldError errors={errors} field="notes" />
            </div>

            <div className="panel-section">
              <label className="panel-label" htmlFor="import-context-refs">Optional files or refs</label>
              <textarea
                className="panel-textarea"
                id="import-context-refs"
                rows={4}
                placeholder="One Markdown, TODO, roadmap file, branch, URL, or doc ref per line"
                value={contextRefs}
                onChange={(e) => setContextRefs(e.target.value)}
              />
            </div>

            <label className="check-row import-check">
              <input type="checkbox" checked={createImmediately} onChange={(e) => setCreateImmediately(e.target.checked)} />
              <span>Create triage tickets after the agent previews the proposed batch</span>
            </label>

            <div className="panel-form-actions">
              <button className="primary-btn" type="submit" disabled={busy}>{busy ? "Generating..." : "Generate prompt"}</button>
              <button className="ghost-btn" type="button" disabled={!prompt || busy} onClick={copyPrompt}>Copy prompt</button>
              <button className="ghost-btn" type="button" onClick={close}>Cancel</button>
            </div>
          </form>

          {prompt ? (
            <div className="panel-section import-prompt-section">
              <div className="panel-section-head">
                <h3>Agent prompt</h3>
                <button className="ghost-btn launch-preview-btn" type="button" onClick={copyPrompt}>Copy</button>
              </div>
              <textarea className="panel-textarea import-prompt-output" readOnly rows={14} value={prompt} />
              <p className="panel-hint">After the agent validates and writes tickets, refresh the Board and review the new triage cards before moving anything forward.</p>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="panel-section"><h3>{title}</h3>{children}</div>;
}

function HomeView({ active, setView }: { active: boolean; setView: (view: View) => void }) {
  const [setup, setSetup] = useState<AnyObj | null>(null);
  const [config, setConfig] = useState<AnyObj | null>(null);
  const [board, setBoard] = useState<AnyObj | null>(null);
  const [usage, setUsage] = useState<AnyObj | null>(null);
  const [scheduler, setScheduler] = useState<AnyObj | null>(null);
  const [runs, setRuns] = useState<AnyObj[] | null>(null);
  const [tickets, setTickets] = useState<AnyObj[] | null>(null);
  const [now, setNow] = useState(Date.now());

  const poll = useCallback(async () => {
    const [setupNext, configNext, boardNext, s, r, t] = await Promise.all([
      getJSON("/api/setup/status"),
      getJSON("/api/config"),
      getJSON("/api/state"),
      getJSON("/api/scheduler"),
      getJSON("/api/runs"),
      getJSON("/api/tickets"),
    ]);
    setSetup(setupNext);
    setConfig(configNext);
    setBoard(boardNext);
    setScheduler(s);
    setRuns(Array.isArray(r) ? r : r == null ? null : []);
    setTickets(Array.isArray(t) ? t : t == null ? null : []);
    setUsage(await getJSON("/api/usage"));
  }, []);

  useEffect(() => {
    if (!active) return;
    poll();
    const pollTimer = window.setInterval(poll, 10000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(pollTimer); window.clearInterval(clockTimer); };
  }, [active, poll]);

  async function toggleAutopilot() {
    const next = !scheduler?.autopilot;
    setScheduler((s) => s ? { ...s, autopilot: next } : s);
    const res = await fetch("/api/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: next }) }).catch(() => null);
    if (res?.ok) setScheduler(await res.json());
    else poll();
  }

  async function resetBreaker() {
    const res = await fetch("/api/breaker/reset", { method: "POST" }).catch(() => null);
    if (res?.ok) setScheduler(await res.json());
  }

  async function initializeFolders() {
    await fetch("/api/setup/init", { method: "POST" }).catch(() => null);
    poll();
  }

  async function createStarterTicket() {
    const repo = setup?.repos?.[0] || config?.repos?.[0] || "workspace";
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "First HelmMate ticket",
        repo,
        priority: "P2",
        status: "triage",
        description: "Created from the Home readiness checklist.",
        acceptance_criteria: ["Ticket appears on the board"],
      }),
    }).catch(() => null);
    await poll();
    if (res?.ok) setView("board");
  }

  async function armBoard() {
    const res = await fetch("/api/arm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ armed: true }),
    }).catch(() => null);
    if (res?.ok) setBoard(await res.json());
    poll();
  }

  async function dispatchTicketFix(ticket: string, kind: string, pr: string) {
    await fetch(`/api/tickets/${encodeURIComponent(ticket)}/fix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, pr }),
    }).catch(() => null);
    poll();
  }

  const block = usage?.block;
  const weekly = usage?.weekly;
  const official = (usage?.source === "official") || (block?.source === "official");
  const resetAt = block?.resetTime ? Date.parse(block.resetTime) : block?.minutesRemaining != null ? now + Number(block.minutesRemaining) * 60000 : null;
  const breaker = scheduler?.breaker;
  const liveRuns = (runs || []).filter((r) => r?.status === "running");
  const finished = (runs || []).filter((r) => r?.status && r.status !== "running").slice(0, 8);
  const selectedEngine = (() => {
    const allowed = Array.isArray(config?.engines) && config.engines.length ? config.engines : ["claude", "codex", "opencode"];
    if (allowed.includes(board?.defaultEngine)) return board?.defaultEngine;
    if (allowed.includes(config?.defaultEngine)) return config?.defaultEngine;
    return "claude";
  })();
  const hasRunHistory = (Array.isArray(runs) && runs.length > 0) || (Array.isArray(scheduler?.running) && scheduler.running.length > 0);
  const ticketList = Array.isArray(tickets) ? tickets : [];
  const byId = new Map(ticketList.map((t) => [t.id, t]));
  const validRepos = new Set(Array.isArray(config?.repos) && config.repos.length ? config.repos : setup?.repos || []);
  const runningIds = new Set([...(Array.isArray(board?.running) ? board.running : []), ...(Array.isArray(scheduler?.running) ? scheduler.running : [])]);
  const repoRows = Array.isArray(setup?.repoStatus) && setup.repoStatus.length
    ? setup.repoStatus
    : Array.from(validRepos).map((key) => ({ key, exists: null, path: "" }));
  const projectConfigured = !!setup?.projectConfigured;
  const reposReady = validRepos.size > 0 && repoRows.every((repo: AnyObj) => repo.exists !== false);
  const supportFoldersReady = setup?.agentDirExists !== false && setup?.memoryQueueDirExists !== false;
  const restart = !!setup?.requiresRestart || !!(setup?.configuredActiveProject && setup?.runtimeActiveProject && setup.configuredActiveProject !== setup.runtimeActiveProject);
  const launchReady = ticketList.filter((ticket) => {
    const deps = Array.isArray(ticket?.depends_on) ? ticket.depends_on : [];
    const unmet = deps.some((id: string) => !byId.get(id) || byId.get(id).status !== "done");
    if (!["triage", "backlog"].includes(ticket?.status)) return false;
    if (runningIds.has(ticket.id) || unmet || !validRepos.has(ticket.repo)) return false;
    return ticket.status === "triage" || (Array.isArray(ticket.acceptance_criteria) && ticket.acceptance_criteria.length > 0);
  });

  const stage = hasRunHistory
    ? "runs"
    : !projectConfigured
    ? "no-project"
    : !setup?.ticketsDirExists || !setup?.indexExists || !supportFoldersReady || !reposReady || restart
    ? "folders-missing"
    : !ticketList.length
    ? "no-tickets"
    : !launchReady.length
    ? "none-launch-ready"
    : "launch-ready";

  function BreakerBanner() {
    if (!breaker?.tripped) return null;
    return (
      <div className="home-breaker" role="alert">
        <div className="home-breaker-main">
          <span className="home-breaker-flag">Usage paused</span>
          <span className="home-breaker-reason">{shortReason(breaker.reason)}. Auto-dispatch is off until <strong>{breaker.until ? new Date(breaker.until).toLocaleTimeString() : "manual reset"}</strong>.</span>
        </div>
        <button className="home-breaker-reset" type="button" onClick={resetBreaker}>Reset breaker</button>
      </div>
    );
  }

  function BlockCard({ quiet = false }: { quiet?: boolean }) {
    const quietClaude = quiet || selectedEngine !== "claude";
    return (
      <HomeCard title="5h Block Usage" sub={!usage || !block ? (quietClaude ? "secondary" : "") : usage?.asOf ? relTime(usage.asOf) : ""}>
        {!usage || !block ? (
          <p className="home-empty">{quietClaude ? "Claude usage is secondary for the current engine." : <>No usage data. <span className="home-na">/api/usage</span> not available.</>}</p>
        ) : !official ? quietClaude ? (
          <>
            <p className="home-empty home-empty--inline">Claude usage is secondary for the current engine.</p>
            <div className="home-note home-dim">Live Claude usage is retrying quietly.</div>
          </>
        ) : (
          <>
            <div className="home-big"><span className="home-big-num home-big--muted">-</span><span className="home-big-label">live 5h usage unavailable</span></div>
            <div className="home-note">Claude usage endpoint unavailable. Retrying quietly.</div>
            <div className="home-note home-dim">Local transcript totals are hidden here because they are not comparable to the real limit.</div>
          </>
        ) : (
          <>
            <div className="home-big"><span className="home-big-num">{fmtPct(block.pct)}</span><span className="home-big-label">of 5h limit</span></div>
            <Gauge pct={block.pct} />
            <div className="home-usage-line"><span className="home-src home-src--live">● LIVE</span> <span className="home-dim">Anthropic usage API · real 5h limit</span></div>
            <div className="home-note">live · Anthropic usage endpoint</div>
            <div className="home-countdown"><span className="home-countdown-label">RESETS IN</span><span className={`home-countdown-val${resetAt && resetAt - now < 15 * 60000 ? " home-countdown-val--soon" : ""}`}>{resetAt ? fmtClock(resetAt - now) : "-"}</span></div>
          </>
        )}
      </HomeCard>
    );
  }

  function CodexOrBurnCard({ quiet = false }: { quiet?: boolean }) {
    if (usage?.codex) {
      return (
        <HomeCard title="Codex Usage" sub={usage.codex.asOf ? relTime(usage.codex.asOf) : ""}>
          <div className="home-big home-big--sm"><span className="home-big-num">{fmtPct(usage.codex.primary?.pct)}</span><span className="home-big-label">5h window</span></div>
          <Gauge pct={usage.codex.primary?.pct} />
          <div className="home-dispatch-grid">
            <MetricRow label="7d window">{fmtPct(usage.codex.secondary?.pct)}</MetricRow>
            <MetricRow label="resets">{untilTime(usage.codex.primary?.resetTime)}</MetricRow>
            <MetricRow label="plan">{usage.codex.planType || "Codex"}</MetricRow>
            <MetricRow label="source"><span className="home-src home-src--live">local</span></MetricRow>
          </div>
        </HomeCard>
      );
    }
    if (quiet && selectedEngine === "codex") {
      return (
        <HomeCard title="Codex Usage" sub="quiet">
          <p className="home-empty home-empty--inline">Codex usage appears after local session data is available.</p>
          <div className="home-note home-dim">Claude burn data is secondary for the current engine.</div>
        </HomeCard>
      );
    }
    return (
      <HomeCard title="Burn Rate">
        {!block ? <p className="home-empty">No burn data. <span className="home-na">/api/usage</span> not available.</p> : (
          <>
            <div className="home-big home-big--sm"><span className="home-big-num">{fmtTokens(block?.burnTokensPerMin)}</span><span className="home-big-label">tokens / min <span className="home-dim">(local)</span></span></div>
            <div className="home-note">local trend signal only</div>
          </>
        )}
      </HomeCard>
    );
  }

  function OpenCodeUsageCard() {
    return (
      <HomeCard title="OpenCode Usage" sub="local logs">
        <p className="home-empty home-empty--inline">OpenCode usage is tracked from completed run logs.</p>
        <div className="home-note home-dim">Claude usage is secondary while OpenCode is the default engine.</div>
      </HomeCard>
    );
  }

  function WeeklyCard({ quiet = false }: { quiet?: boolean }) {
    const quietClaude = quiet || selectedEngine !== "claude";
    return (
      <HomeCard title="Weekly Usage" sub={quietClaude && (!weekly || weekly.source !== "official") ? "secondary" : ""}>
        {!weekly ? <p className="home-empty">{quietClaude ? "Claude weekly usage is secondary for the current engine." : "No weekly data."}</p> : weekly.source !== "official" ? quietClaude ? (
          <>
            <p className="home-empty home-empty--inline">Claude weekly usage is secondary for the current engine.</p>
            <div className="home-note home-dim">Live Claude usage is retrying quietly.</div>
          </>
        ) : (
          <>
            <div className="home-big home-big--sm"><span className="home-big-num home-big--muted">-</span><span className="home-big-label">live 7d usage unavailable</span></div>
            <div className="home-note">Claude usage endpoint unavailable. Retrying quietly.</div>
          </>
        ) : (
          <>
            <div className="home-big home-big--sm"><span className="home-big-num">{fmtPct(weekly.pct)}</span><span className="home-big-label">of 7d limit</span></div>
            <Gauge pct={weekly.pct} />
            <div className="home-usage-line"><span className="home-src home-src--live">● LIVE</span> <span className="home-dim">7-day window · Anthropic usage API</span></div>
          </>
        )}
      </HomeCard>
    );
  }

  function DispatchCard() {
    return (
      <HomeCard title="Dispatch">
        {!scheduler ? <p className="home-empty">Scheduler offline. <span className="home-na">/api/scheduler</span> not available.</p> : (
          <>
            <div className="home-dispatch-top">
              <span className={`home-pill ${!scheduler.autopilot ? "home-pill--off" : scheduler.armed ? "home-pill--on" : "home-pill--warn"}`}>{!scheduler.autopilot ? "OFF" : scheduler.armed ? "ON" : "PAUSED"}</span>
              <button type="button" className={`home-toggle ${scheduler.autopilot ? "home-toggle--on" : "home-toggle--off"}`} onClick={toggleAutopilot}>
                <span className="home-toggle-dot" />{scheduler.autopilot ? "Auto-dispatch ON" : "Auto-dispatch OFF"}
              </button>
            </div>
            <div className="home-dispatch-grid">
              <MetricRow label="mode">{scheduler.mode === "night" ? "Night" : "Day"}{scheduler.nightOnly ? " · night-only" : ""}</MetricRow>
              <MetricRow label="active cap">{fmtFractionPct(scheduler.activeCapPct)}</MetricRow>
              <MetricRow label="next poll">{num(scheduler.nextPollInSec) != null ? fmtMin(num(scheduler.nextPollInSec)! / 60) : "-"}</MetricRow>
              <MetricRow label="WIP limit">{fmtInt(scheduler.wipLimit)}</MetricRow>
            </div>
            <div className="home-sub-head">Recent decisions</div>
            {scheduler.lastDecisions?.length ? (
              <ul className="home-list">
                {(scheduler.lastDecisions || []).slice(-4).reverse().map((d: AnyObj, idx: number) => (
                  <li key={idx}>
                    <span className={`home-tag ${d.action === "dispatched" ? "home-tag--on" : d.action === "paused" ? "home-tag--warn" : "home-tag--dim"}`}>{d.action || "?"}</span>
                    <span className="home-list-main">{d.ticket || "-"}</span>
                    <span className="home-list-meta home-list-reason" title={d.reason || ""}>{shortReason(d.reason)}</span>
                    <span className="home-list-meta home-dim">{relTime(d.ts)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="home-empty home-empty--inline">No recent decisions.</p>}
          </>
        )}
      </HomeCard>
    );
  }

  function ReadinessHome() {
    const copy: AnyObj = {
      "no-project": ["first run", "Connect a project", "Choose or create a project configuration before HelmMate can prepare tickets."],
      "folders-missing": ["setup", "Clear setup checks", "Create support folders, confirm the active project, and make sure repos are reachable."],
      "no-tickets": ["ready", "Create a first ticket", "The workspace is connected. Start with one reviewed, small task."],
      "none-launch-ready": ["needs review", "Make one ticket launch-ready", "Tickets exist, but none currently pass repo, dependency, status, and acceptance checks."],
      "launch-ready": ["launch-ready", "Ready for controlled dispatch", "At least one ticket can launch after you choose the launch safety posture."],
    };
    const [kicker, title, detail] = copy[stage] || copy["no-project"];
    const repoDetail = repoRows.length
      ? repoRows.map((repo: AnyObj) => `${repo.key}: ${repo.exists === true ? "ok" : repo.exists === false ? "missing" : "configured"}${repo.path ? ` (${repo.path})` : ""}`).join("; ")
      : "none";
    const step = (ok: boolean, label: string, value: string, tone = "") => (
      <li className={`${ok ? "projects-step projects-step--done" : "projects-step"}${tone ? ` projects-step--${tone}` : ""}`} key={label}>
        <span className="projects-step-dot" /><span className="projects-step-main">{label}</span><span className="projects-step-detail">{value}</span>
      </li>
    );
    const blockers = [
      !projectConfigured ? "Project config missing" : "",
      restart ? "Server restart required" : "",
      !setup?.ticketsDirExists || !setup?.indexExists ? "Ticket index missing" : "",
      !supportFoldersReady ? "Agent or memory folder missing" : "",
      !reposReady ? "Repo mapping needs attention" : "",
      ticketList.length && !launchReady.length ? "No launch-ready ticket" : "",
    ].filter(Boolean);
    let lead = "Open Projects to connect a workspace.";
    let actions: React.ReactNode = <button className="projects-btn projects-btn--primary" type="button" onClick={() => setView("projects")}>Open Projects</button>;
    if (stage === "folders-missing") {
      lead = restart ? "Restart the server after the selected project change, then refresh Home." : "Initialize the local ticket and agent folders.";
      actions = <><button className="projects-btn projects-btn--primary" type="button" onClick={initializeFolders}>Initialize folders</button><button className="projects-btn" type="button" onClick={() => setView("projects")}>Open Projects</button><button className="projects-btn" type="button" onClick={poll}>Refresh</button></>;
    } else if (stage === "no-tickets") {
      lead = "Create a small starter ticket, then review it on the Board.";
      actions = <><button className="projects-btn projects-btn--primary" type="button" onClick={createStarterTicket}>Create starter ticket</button><button className="projects-btn" type="button" onClick={() => setView("board")}>Open Board</button><button className="projects-btn" type="button" onClick={() => setView("projects")}>Open Projects</button></>;
    } else if (stage === "none-launch-ready") {
      lead = "Review ticket status, dependencies, repo, and acceptance criteria.";
      actions = <><button className="projects-btn projects-btn--primary" type="button" onClick={() => setView("board")}>Review Board</button><button className="projects-btn" type="button" onClick={createStarterTicket}>Create starter ticket</button><button className="projects-btn" type="button" onClick={() => setView("projects")}>Run Doctor</button></>;
    } else if (stage === "launch-ready") {
      const armed = !!board?.armed;
      const autopilot = !!scheduler?.autopilot;
      lead = !armed ? "Arm the board when you want launch-ready tickets to run." : !autopilot ? "Enable auto-dispatch to let the scheduler dispatch ready work." : "The scheduler can dispatch on its next poll.";
      actions = <><button className="projects-btn projects-btn--primary" type="button" onClick={!armed ? armBoard : !autopilot ? toggleAutopilot : () => setView("board")}>{!armed ? "Arm board" : !autopilot ? "Enable auto-dispatch" : "Open Board"}</button><button className="projects-btn" type="button" onClick={() => setView("board")}>Review Board</button><button className="projects-btn" type="button" onClick={poll}>Refresh</button></>;
    }

    return (
      <>
        <BreakerBanner />
        <div className="home-ready-grid">
          <HomeCard title="Operational Brief" sub={blockers.length ? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}` : "clear"}>
            <div className="home-ready-hero"><span className="home-ready-kicker">{kicker}</span><h2>{title}</h2><p>{detail}</p></div>
            <div className="home-ready-stats">
              <MetricRow label="workspace">{setup?.activeProject || config?.activeProject || "none"}</MetricRow>
              <MetricRow label="ticket queue">{fmtInt(ticketList.length)} total · {fmtInt(launchReady.length)} ready</MetricRow>
              <MetricRow label="launch safety">{board?.armed ? "armed" : "disarmed"}</MetricRow>
              <MetricRow label="dispatcher">{scheduler?.autopilot ? "auto-dispatch on" : "manual"}</MetricRow>
            </div>
          </HomeCard>
          <HomeCard title="Next Actions">
            <p className="home-ready-lead">{lead}</p>
            <div className="projects-actions">{actions}</div>
            <div className="home-note home-dim">Home stays in readiness mode until a run is active or recorded.</div>
          </HomeCard>
          <HomeCard title="Readiness Checks" sub={stage === "launch-ready" ? `${launchReady.length} ready` : "next check"}>
            <ul className="projects-steps">
              {step(projectConfigured && !restart, "Workspace loaded", restart ? setup?.restartReason || "restart needed" : setup?.runtimeActiveProject || setup?.activeProject || "loaded", restart ? "warn" : "")}
              {step(!!setup?.ticketsDirExists && !!setup?.indexExists, "Ticket queue", setup?.indexExists ? `${setup?.ticketsDir || "tickets"} ready` : "initialize folders")}
              {step(supportFoldersReady, "Agent support", supportFoldersReady ? "agents and memory queue available" : "initialize folders or run setup")}
              {step(reposReady, "Repo routing", repoDetail)}
              {step(launchReady.length > 0, "Launch candidate", launchReady.length ? launchReady.slice(0, 3).map((t) => t.id).join(", ") : ticketList.length ? "fix status, deps, repo, or acceptance criteria" : "create a starter ticket")}
              {step(board?.armed === false, "Safe by default", board?.armed === true ? "currently armed" : board?.armed === false ? "disarmed" : "unknown", board?.armed === true ? "warn" : "")}
            </ul>
          </HomeCard>
          <DispatchCard />
          <HomeCard title="Default Engine" sub="routing">
            <div className="home-big home-big--sm"><span className="home-big-num">{engineLabel(selectedEngine)}</span><span className="home-big-label">selected for launches</span></div>
            <div className="home-note">{selectedEngine === "codex" ? "Claude usage is secondary while Codex is the default engine." : selectedEngine === "opencode" ? "Claude usage is secondary while OpenCode is the default engine." : "Claude usage matters for Claude launches and scheduler caps."}</div>
          </HomeCard>
          {selectedEngine === "codex" ? <CodexOrBurnCard quiet /> : selectedEngine === "opencode" ? <OpenCodeUsageCard /> : <BlockCard />}
        </div>
      </>
    );
  }

  if (!hasRunHistory) {
    return <main className="home"><ReadinessHome /></main>;
  }

  return (
    <main className="home">
      <BreakerBanner />
      <div className={`home-grid${selectedEngine !== "claude" ? " home-grid--codex" : ""}`}>
        {selectedEngine === "codex" ? <CodexOrBurnCard quiet /> : selectedEngine === "opencode" ? <OpenCodeUsageCard /> : <BlockCard />}
        {selectedEngine === "claude" ? <CodexOrBurnCard /> : <BlockCard quiet />}
        <WeeklyCard quiet={selectedEngine !== "claude"} />
        <DispatchCard />

        <HomeCard title="Running Now" sub={liveRuns.length ? String(liveRuns.length) : "idle"}>
          {liveRuns.length ? <ul className="home-list">{liveRuns.map((r) => <li key={r.run_id}><span className="home-list-main mono">{r.ticket_id || r.run_id}</span><span className="home-list-meta">{fmtTokens(r.tokens_metric)} tok</span><span className="home-list-meta home-dim">{fmtDuration(r.started_at, null)}</span></li>)}</ul> : <p className="home-empty home-empty--inline">Nothing running.</p>}
        </HomeCard>

        <HomeCard title="Recent Dispatches" sub={finished.length ? `${finished.length} shown` : ""}>
          {runs == null ? <p className="home-empty"><span className="home-na">/api/runs</span> not available.</p> : finished.length ? (
            <ul className="home-list">{finished.map((r) => <li key={r.run_id}><span className={`home-tag ${r.status === "exited" ? "home-tag--on" : "home-tag--warn"}`}>{r.status}</span><span className="home-list-main mono">{r.ticket_id || r.run_id}</span><span className="home-list-meta">{fmtTokens(r.tokens_metric)} tok</span><span className="home-list-meta">{fmtUSD(r.costUSD)}</span><span className="home-list-meta home-dim">{fmtDuration(r.started_at, r.ended_at)}</span></li>)}</ul>
          ) : <p className="home-empty home-empty--inline">No completed runs yet.</p>}
        </HomeCard>

        <HomeCard title="CI Watch" sub={scheduler?.ciWatch ? String(scheduler.ciWatch.length) : ""}>
          {!scheduler?.ciWatch?.length ? <p className="home-empty home-empty--inline">No PRs being watched.</p> : (
            <ul className="home-list">{scheduler.ciWatch.map((c: AnyObj, idx: number) => {
              const st = c.state || "unknown";
              const cls = st === "pass" ? "home-tag--on" : st === "fail" || st === "conflict" ? "home-tag--bad" : st === "pending" ? "home-tag--warn" : "home-tag--dim";
              const n = c.pr ? (String(c.pr).match(/\/pull\/(\d+)/) || [])[1] : null;
              return <li key={idx}><span className={`home-tag ${cls}`}>{st}</span><span className="home-list-main mono">{c.ticket || "-"}</span><span className="home-list-meta">{n ? `${c.repo || ""} #${n}` : "-"}</span>{c.fixable ? <button type="button" className="home-ci-fix" onClick={() => dispatchTicketFix(c.ticket, st === "conflict" ? "conflict-fix" : "ci-fix", c.pr)}>{st === "conflict" ? "Resolve" : "Fix CI"}</button> : null}</li>;
            })}</ul>
          )}
        </HomeCard>
      </div>
    </main>
  );
}

function AgentsView({ active }: { active: boolean }) {
  const [data, setData] = useState<AnyObj | null>(null);
  const [queue, setQueue] = useState<AnyObj | null>(null);

  const refresh = useCallback(async () => {
    const [d, q] = await Promise.all([getJSON("/api/agents"), getJSON("/api/memory-queue")]);
    setData(d);
    setQueue(q);
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  const usage = data?.usage || {};
  const setup = data?.setup || null;
  const locations = setup?.locations || {};
  const pending = Array.isArray(queue?.pending) ? queue.pending : [];
  const roles = Array.isArray(setup?.roles) && setup.roles.length ? setup.roles : data?.agents || [];
  return (
    <main className="agents">
      <div className="agents-view">
        <div className="agents-header"><h2 className="agents-title">Agents</h2><button className="agents-refresh-btn" type="button" onClick={refresh}>Refresh</button></div>
        {!data ? <p className="agents-error home-empty"><span className="home-na">/api/agents</span> not available - check server.</p> : null}
        {data ? (
          <>
            <AgentsSetupOverview setup={setup} />
            <div className="agents-editor-grid">{roles.map((agent: AnyObj) => <AgentRoleCard key={agent.role} agent={agent} usageByRole={usage.byRole || {}} codexConfig={data.codex || {}} opencodeConfig={data.opencode || {}} />)}</div>
            <div className="agents-spend-section">
              <SpendCard title="Spend by model" buckets={usage.byModel} kind="model" />
              <SpendCard title="Spend by role" buckets={usage.byRole} kind="role" />
              <SpendCard title="Spend by engine" buckets={usage.byEngine} kind="engine" hint="Codex bills against your ChatGPT plan. OpenCode uses OpenCode Go model routing when selected." />
            </div>
          </>
        ) : null}
        <section className="home-card agents-queue-card">
          <div className="home-card-head"><h3>Memory proposal location</h3><span className={`agents-queue-count${pending.length ? " agents-queue-count--has" : ""}`}>{pending.length ? `${pending.length} pending` : "none pending"}</span></div>
          <div className="home-card-body">
            <PathRow label="queue" value={locations.memoryQueueDir || "memory/sync-queue"} />
            {!pending.length ? <p className="home-empty">No pending proposals. Autonomous sessions drop durable learnings here for human review.</p> : pending.map((p: AnyObj) => (
              <div className="agents-queue-item" key={p.id}>
                <div className="agents-queue-item-head"><span className="agents-queue-id">{p.id}</span><span className="agents-queue-meta">{fmtInt(p.proposalCount)} proposals</span><span className="agents-queue-path">{p.path || `${locations.memoryQueueDir || "memory/sync-queue"}/${p.id}.md`}</span></div>
                <details className="agents-queue-details"><summary>view proposal</summary><pre className="agents-queue-pre">{p.content}</pre></details>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return <span className={`agents-file-badge ${ok ? "agents-file-badge--ok" : "agents-file-badge--missing"}`}>{label || (ok ? "exists" : "missing")}</span>;
}

function PathRow({ label, value, ok }: { label: string; value?: string; ok?: boolean }) {
  return (
    <div className="agents-path-row">
      <span>{label}</span>
      <code>{value || "not configured"}</code>
      {typeof ok === "boolean" ? <StatusBadge ok={ok} /> : null}
    </div>
  );
}

function AgentsSetupOverview({ setup }: { setup: AnyObj | null }) {
  if (!setup) return null;
  const engine = setup.engine || {};
  const permissions = setup.permissions || {};
  const locations = setup.locations || {};
  const prompts = Array.isArray(setup.prompts) ? setup.prompts : [];
  const routing = setup.roleRouting || {};
  const mappings = Array.isArray(routing.repoMappings) ? routing.repoMappings : [];

  return (
    <section className="agents-setup-section">
      <div className="agents-section-head"><h3>Before launch</h3><span>read-only setup review</span></div>
      <div className="agents-trust-grid">
        <section className="home-card agents-trust-card">
          <div className="home-card-head"><h3>Default engine</h3><span className="agents-badge agents-badge--haiku">{engine.default || "unknown"}</span></div>
          <div className="home-card-body">
            <p className="agents-copy">{engine.explanation || ""}</p>
            <div className="agents-kv-grid">
              <div><span>board default</span><strong>{engine.default || "unknown"}</strong></div>
              <div><span>config default</span><strong>{engine.configuredDefault || "unknown"}</strong></div>
              <div><span>allowed</span><strong>{(engine.allowed || []).join(", ") || "none"}</strong></div>
            </div>
            <PathRow label="Claude command" value={engine.commands?.claude} />
            <PathRow label="Codex command" value={engine.commands?.codex} />
            <PathRow label="OpenCode command" value={engine.commands?.opencode} />
          </div>
        </section>

        <section className="home-card agents-trust-card agents-trust-card--wide">
          <div className="home-card-head"><h3>Role routing</h3></div>
          <div className="home-card-body">
            <p className="agents-copy">{routing.explanation || ""}</p>
            <table className="agents-routing-table">
              <thead><tr><th>repo</th><th>role</th><th>mode</th><th>status</th></tr></thead>
              <tbody>{mappings.length ? mappings.map((repo: AnyObj) => (
                <tr key={repo.key}>
                  <td>{repo.key}</td>
                  <td>{repo.role || "cross-repo"}</td>
                  <td>{repo.worktree ? "worktree" : "in-place"}</td>
                  <td><StatusBadge ok={!!repo.exists} label={repo.exists ? "repo found" : "missing"} /></td>
                </tr>
              )) : <tr><td colSpan={4}>No repos configured.</td></tr>}</tbody>
            </table>
          </div>
        </section>

        <section className="home-card agents-trust-card">
          <div className="home-card-head"><h3>Prompt files</h3></div>
          <div className="home-card-body agents-path-stack">
            {prompts.length ? prompts.map((p: AnyObj) => <PathRow key={p.key || p.label} label={p.label || p.key} value={`${p.ref || ""}${p.path ? ` -> ${p.path}` : ""}`} ok={!!p.exists} />) : <p className="home-empty">No prompt files configured.</p>}
          </div>
        </section>

        <section className="home-card agents-trust-card agents-warning-card">
          <div className="home-card-head"><h3>Permission warning</h3><StatusBadge ok={false} label="review" /></div>
          <div className="home-card-body">
            <p className="agents-copy">{permissions.text || ""}</p>
            <div className="agents-path-stack">
              <PathRow label="Claude flag" value={permissions.claude} />
              <PathRow label="Codex flag" value={permissions.codex} />
              <PathRow label="OpenCode flag" value={permissions.opencode} />
              <PathRow label="Run logs" value={locations.ticketLogPattern || locations.logsDir} />
              <PathRow label="Runs ledger" value={locations.runsLedger} />
              <PathRow label="Memory proposals" value={locations.memoryProposalPattern || locations.memoryQueueDir} />
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function SpendCard({ title, buckets, kind, hint }: AnyObj) {
  const rows = Object.entries(buckets || {}).sort((a: any, b: any) => (num(b[1].runs) || 0) - (num(a[1].runs) || 0));
  return (
    <section className="home-card agents-spend-card">
      <div className="home-card-head"><h3>{title}</h3></div>
      <div className="home-card-body">
        {!rows.length ? <p className="home-empty">No {kind} spend data.</p> : (
          <table className="agents-spend-table"><thead><tr><th>{kind}</th><th>runs</th><th>tokens</th><th>cost</th></tr></thead><tbody>{rows.map(([key, v]: any) => <tr key={key}><td className={kind === "model" && String(key).toLowerCase().includes("opus") ? "agents-spend-name agents-spend-name--opus" : "agents-spend-name"}>{key}</td><td className="agents-spend-num">{fmtInt(v.runs)}</td><td className="agents-spend-num">{fmtTokens(v.tokens_metric)}</td><td className="agents-spend-num">{fmtUSD(v.cost_usd, v.has_cost)}</td></tr>)}</tbody></table>
        )}
        {hint ? <p className="panel-hint">{hint}</p> : null}
      </div>
    </section>
  );
}

function AgentRoleCard({ agent, usageByRole, codexConfig, opencodeConfig }: AnyObj) {
  const roleUsage = usageByRole?.[agent.role];
  const persona = agent.persona || agent;
  const exists = agent.exists !== false && persona.exists !== false;
  const preview = persona.preview != null ? persona.preview : agent.body || "";
  const claude = agent.claude || {};
  const codexModel = codexConfig.modelByRole?.[agent.role] || agent.codex?.model || "gpt-5.4-mini";
  const codexEffort = codexConfig.effortByRole?.[agent.role] || agent.codex?.effort || "medium";
  const opencodeModel = opencodeConfig.modelByRole?.[agent.role] || agent.opencode?.model || "opencode-go/minimax-m2.7";
  const opencodeVariant = opencodeConfig.variantByRole?.[agent.role] || agent.opencode?.variant || "default variant";

  return (
    <section className="home-card agents-editor-card">
      <div className="home-card-head"><h3>{agent.role}</h3><StatusBadge ok={exists} label={exists ? "persona found" : "persona missing"} /></div>
      <div className="home-card-body">
        <p className="agents-copy">{agent.meaning || "Repo-specific implementation role."}</p>
        <div className="agents-runs-line">{roleUsage ? `${fmtInt(roleUsage.runs)} runs · ${fmtUSD(roleUsage.cost_usd, roleUsage.has_cost)}` : "no runs yet"}</div>
        <div className="agents-model-grid">
          <div><span>Claude model</span><strong>{claude.model || agent.model || agent.configuredModel || "sonnet"}</strong><small>{claude.source || (agent.model ? "persona frontmatter" : "role config")}</small></div>
          <div><span>Codex model</span><strong>{codexModel}</strong><small>effort {codexEffort}</small></div>
          <div><span>OpenCode model</span><strong>{opencodeModel}</strong><small>{opencodeVariant}</small></div>
        </div>
        <PathRow label="persona" value={persona.path || agent.path} ok={exists} />
        <details className="agents-persona-details" open={exists && !!preview}>
          <summary>persona preview</summary>
          {exists && preview ? <pre className="agents-persona-pre">{preview}{persona.previewTruncated ? "\n..." : ""}</pre> : <p className="home-empty">Missing or empty persona file.</p>}
        </details>
      </div>
    </section>
  );
}

function ProjectsView({ active, refreshBoard, setView }: { active: boolean; refreshBoard: () => Promise<void>; setView: (v: View) => void }) {
  const [data, setData] = useState<AnyObj | null>(null);
  const [setup, setSetup] = useState<AnyObj | null>(null);
  const [boardState, setBoardState] = useState<AnyObj | null>(null);
  const [selectedId, setSelectedId] = useState("default");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [doctorStatus, setDoctorStatus] = useState("");
  const [setupPrompt, setSetupPrompt] = useState("");
  const [setupMode, setSetupMode] = useState("existing");
  const [doctorPrompt, setDoctorPrompt] = useState("");

  const refresh = useCallback(async () => {
    const [d, s, st] = await Promise.all([getJSON("/api/projects"), getJSON("/api/setup/status"), getJSON("/api/state")]);
    setData(d);
    setSetup(s);
    setBoardState(st);
    setSelectedId((cur) => cur || d?.activeProject || d?.runtimeActiveProject || Object.keys(d?.projects || {})[0] || "default");
  }, []);

  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  const ids = Object.keys(data?.projects || {});
  const selected = data?.projects?.[selectedId] || data?.projects?.[data?.activeProject] || {};
  const id = selectedId || data?.activeProject || "default";

  async function initializeProject() {
    await fetch("/api/setup/init", { method: "POST" });
    refresh();
  }

  async function createStarterTicket() {
    const title = (document.getElementById("projects-starter-title") as HTMLInputElement)?.value.trim() || "First HelmMate ticket";
    await fetch("/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, repo: setup?.repos?.[0] || "workspace", priority: "P2", status: "triage", description: "Created from the HelmMate onboarding flow.", acceptance_criteria: ["Ticket appears on the board"] }) });
    await refreshBoard();
    setView("board");
  }

  function quickValues() {
    const name = (document.getElementById("projects-quick-name") as HTMLInputElement)?.value.trim() || "";
    const path = (document.getElementById("projects-quick-path") as HTMLInputElement)?.value.trim() || ".";
    const fallbackSource = name || leafName(path) || selected.name || id || "default";
    const fallback = slugProjectId(fallbackSource);
    return {
      id: fallback,
      name: name || fallback,
      workspaceDir: path,
      ticketIdPrefix: inferTicketPrefix(name || fallback),
      preferredEngine: (document.getElementById("projects-quick-engine") as HTMLSelectElement)?.value || "unknown",
    };
  }

  async function generateSetupPrompt(mode = "existing", copy = false) {
    const q = quickValues();
    if (!q.id) {
      setStatus("Project id is required.");
      return;
    }
    setSetupMode(mode);
    try {
      const res = await fetch("/api/setup/agent-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          projectId: q.id,
          name: q.name,
          workspaceDir: q.workspaceDir,
          ticketIdPrefix: q.ticketIdPrefix,
          preferredEngine: q.preferredEngine,
          helmMateDir: setup?.helmMateDir,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Prompt failed (${res.status})`);
      const prompt = body.prompt || "";
      setSetupPrompt(prompt);
      if (copy) {
        await navigator.clipboard.writeText(prompt);
        setStatus("Generated and copied setup prompt.");
      } else {
        setStatus("Generated setup prompt. Review it, then copy it into Claude Code, Codex, or opencode.");
      }
    } catch (err: any) {
      setStatus(`Could not generate setup prompt: ${err.message}`);
    }
  }

  async function copyAgentPrompt() {
    if (!setupPrompt) {
      await generateSetupPrompt(setupMode, true);
      return;
    }
    await navigator.clipboard.writeText(setupPrompt);
    setStatus("Copied setup prompt.");
  }

  async function generateDoctorPrompt(copy = false) {
    try {
      const res = await fetch("/api/setup/doctor-prompt", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Prompt failed (${res.status})`);
      const prompt = body.prompt || "";
      setDoctorPrompt(prompt);
      if (copy) {
        await navigator.clipboard.writeText(prompt);
        setDoctorStatus("Generated and copied Doctor prompt.");
      } else {
        setDoctorStatus("Generated Doctor prompt. Review it, then copy it into Claude Code, Codex, or opencode.");
      }
    } catch (err: any) {
      setDoctorStatus(`Could not generate Doctor prompt: ${err.message}`);
    }
  }

  async function copyDoctorPrompt() {
    if (!doctorPrompt) {
      await generateDoctorPrompt(true);
      return;
    }
    await navigator.clipboard.writeText(doctorPrompt);
    setDoctorStatus("Copied Doctor prompt.");
  }

  async function saveSelected() {
    let repos = {};
    try {
      repos = JSON.parse((document.getElementById("projects-repos") as HTMLTextAreaElement)?.value || "{}");
    } catch {
      setStatus("Repos must be valid JSON.");
      return;
    }
    const payload = {
      name: (document.getElementById("projects-name") as HTMLInputElement)?.value.trim() || id,
      workspaceDir: (document.getElementById("projects-workspace") as HTMLInputElement)?.value.trim() || ".",
      ticketsDir: (document.getElementById("projects-tickets") as HTMLInputElement)?.value.trim() || "tickets",
      ticketIdPrefix: (document.getElementById("projects-prefix") as HTMLInputElement)?.value.trim() || "DB",
      agentDir: (document.getElementById("projects-agents") as HTMLInputElement)?.value.trim() || ".agents",
      memoryQueueDir: (document.getElementById("projects-memory") as HTMLInputElement)?.value.trim() || "memory/sync-queue",
      workPrompt: (document.getElementById("projects-work-prompt") as HTMLInputElement)?.value.trim() || "scripts/work-ticket-prompt.md",
      fixCiPrompt: (document.getElementById("projects-ci-prompt") as HTMLInputElement)?.value.trim() || "scripts/fix-ci-prompt.md",
      fixConflictPrompt: (document.getElementById("projects-conflict-prompt") as HTMLInputElement)?.value.trim() || "scripts/fix-conflict-prompt.md",
      statuses: ((document.getElementById("projects-statuses") as HTMLInputElement)?.value || "").split(",").map((x) => x.trim()).filter(Boolean),
      repos,
    };
    const targetId = (document.getElementById("projects-id") as HTMLInputElement)?.value.trim() || id;
    const res = await fetch(`/api/projects/${encodeURIComponent(targetId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) {
      setData(await res.json());
      setSelectedId(targetId);
      setStatus("Saved project config.");
    }
  }

  async function activateSelected() {
    const res = await fetch("/api/projects/active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (res.ok) {
      setData(await res.json());
      setStatus("Active project saved. Restart the server to load its paths.");
    }
  }

  async function deleteSelected() {
    if (!confirm(`Delete project config "${id}"?`)) return;
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      const d = await res.json();
      setData(d);
      setSelectedId(d.activeProject || Object.keys(d.projects || {})[0] || "default");
    }
  }

  const repos = selected.repos || { workspace: { path: ".", baseBranch: "main", worktree: false, role: "cross-repo" } };
  const statuses = Array.isArray(selected.statuses) ? selected.statuses.join(", ") : "triage, backlog, queued, in_progress, blocked, human_review, done";
  const engine = selected.engines?.default || "unknown";
  const mismatch = !!(setup?.configuredActiveProject && setup?.runtimeActiveProject && setup.configuredActiveProject !== setup.runtimeActiveProject);
  const repoRows = Array.isArray(setup?.repoStatus) && setup.repoStatus.length
    ? setup.repoStatus
    : (setup?.repos || []).map((key: string) => ({ key, exists: null, path: "" }));
  const repoDetail = repoRows.length
    ? repoRows.map((repo: AnyObj) => {
      const state = repo.exists === true ? "ok" : repo.exists === false ? "missing" : "configured";
      return `${repo.key}: ${state}${repo.path ? ` (${repo.path})` : ""}`;
    }).join("; ")
    : "none";
  const reposOk = repoRows.length > 0 && repoRows.every((repo: AnyObj) => repo.exists !== false);
  const setupRows = [
    ["Project config", !!setup?.configPath, setup?.configPath || "unknown"],
    ["Runtime project", !mismatch, mismatch ? `${setup?.configuredActiveProject} selected, ${setup?.runtimeActiveProject} running` : setup?.runtimeActiveProject || setup?.activeProject || "unknown"],
    ["Server restart", !setup?.requiresRestart, setup?.requiresRestart ? "needed to load the selected active project" : "not needed", setup?.requiresRestart ? "warn" : ""],
    ["Ticket queue", !!setup?.ticketsDirExists && !!setup?.indexExists, setup?.indexExists ? `${setup?.ticketsDir || "tickets"} ready` : setup?.ticketsDir || "not configured"],
    ["Repo routing", reposOk, repoDetail],
    ["Board armed", boardState?.armed === false, boardState?.armed === true ? "armed" : boardState?.armed === false ? "disarmed" : "unknown", boardState?.armed === true ? "warn" : ""],
    ["Auto-dispatch", boardState?.autopilot === false, boardState?.autopilot === true ? "on" : boardState?.autopilot === false ? "off" : "unknown", boardState?.autopilot === true ? "warn" : ""],
  ];
  const prerequisiteRows = [
    ["Skill pack", !!setup?.skillInstallCommand, "Install once into Codex and Claude skill folders."],
    ["Coding agent", true, "Open the target workspace in Claude Code, Codex, or opencode before pasting setup prompts."],
    ["Git workspace", reposOk, reposOk ? "Repo paths resolve from the running project config." : "Run setup or Doctor to repair repo mapping."],
    ["Ticket validation", !!setup?.indexExists, "Run npm run validate:tickets after agent-created ticket changes."],
    ["Launch review", boardState?.armed === false, "Keep the board disarmed until launch preview and ticket quality look right."],
  ];
  const readyLabel = setup?.ready && !setup?.requiresRestart && !mismatch ? "Ready" : "Needs setup";

  return (
    <main className="projects">
      <div className="projects-view">
        <div className="agents-header"><h2 className="agents-title">Projects</h2><button className="agents-refresh-btn" type="button" onClick={refresh}>Refresh</button></div>
        {data?.requiresRestartToSwitch ? <div className="home-breaker projects-restart"><div className="home-breaker-main"><span className="home-breaker-flag">Restart needed</span><span className="home-breaker-reason">The selected active project differs from the project currently loaded by the server.</span></div></div> : null}
        <section className="projects-command-center">
          <div className="projects-command-main">
            <span className={`projects-health ${readyLabel === "Ready" ? "projects-health--ok" : ""}`}>{readyLabel}</span>
            <h2>{selected.name || id}</h2>
            <p>Use this page to connect a workspace, copy agent setup prompts, and verify the prerequisites before any ticket is dispatched.</p>
          </div>
          <div className="projects-command-grid">
            <div><span>active</span><strong>{data?.activeProject || "none"}</strong></div>
            <div><span>running</span><strong>{setup?.runtimeActiveProject || "none"}</strong></div>
            <div><span>repos</span><strong>{repoRows.length || 0}</strong></div>
            <div><span>safety</span><strong>{boardState?.armed ? "armed" : "disarmed"}</strong></div>
          </div>
        </section>
        <section className="home-card projects-guided-card" key={`guided-${id}`}><div className="home-card-head"><h3>Setup handoff</h3><span className="home-card-sub">agent-assisted</span></div><div className="home-card-body">
          <div className="projects-form-grid projects-quick-grid"><ProjectField label="Name" id="projects-quick-name" value={selected.name || id} /><ProjectField label="Workspace path" id="projects-quick-path" value={selected.workspaceDir || "."} /><ProjectEngineField value={engine} /></div>
          <div className="projects-agent-card"><div><span className="projects-flow-kicker">Use Claude Code, Codex, or opencode</span><p className="projects-agent-copy">Open Claude Code, Codex, or opencode in the project folder. HelmMate will infer the project ID, ticket prefix, repo mapping, folders, and config defaults from the workspace.</p></div><div className="projects-actions"><button className="projects-btn projects-btn--primary" type="button" onClick={() => generateSetupPrompt("existing")}>Existing repo prompt</button><button className="projects-btn" type="button" onClick={() => generateSetupPrompt("new")}>No project yet prompt</button><button className="projects-btn" type="button" onClick={copyAgentPrompt}>{setupPrompt ? "Copy prompt" : "Generate & copy"}</button></div></div>
          {setupPrompt ? <div className="projects-prompt-wrap"><label className="projects-label" htmlFor="projects-setup-prompt">Generated prompt</label><textarea className="projects-textarea projects-prompt" id="projects-setup-prompt" rows={16} readOnly value={setupPrompt} /></div> : null}
          <p className="projects-note">The handoff prompt includes this HelmMate folder path and tells the agent to preserve unrelated config, preview changes, validate tickets, and keep the board disarmed.</p><span className="projects-status">{status}</span>
        </div></section>
        <section className="home-card projects-setup-card"><div className="home-card-head"><h3>Readiness Doctor</h3><span className="home-card-sub">{setup?.ready && !setup?.requiresRestart && !mismatch ? "basic checks pass" : "check before arming"}</span></div><div className="home-card-body"><div className="projects-doctor-grid"><ul className="projects-steps">{setupRows.map(([label, ok, detail, tone]: any[]) => <li key={label} className={`${ok ? "projects-step projects-step--done" : "projects-step"}${tone ? ` projects-step--${tone}` : ""}`}><span className="projects-step-dot" /><span className="projects-step-main">{label}</span><span className="projects-step-detail">{detail || "not configured"}</span></li>)}</ul><ul className="projects-steps projects-prereqs">{prerequisiteRows.map(([label, ok, detail]: any[]) => <li key={label} className={ok ? "projects-step projects-step--done" : "projects-step"}><span className="projects-step-dot" /><span className="projects-step-main">{label}</span><span className="projects-step-detail">{detail}</span></li>)}</ul></div><p className="projects-note">UI checks catch local config drift. Doctor asks Claude Code, Codex, or opencode to verify git auth, installed CLIs, worktree mode, prompt files, personas, PR readiness, and process safety. {setup?.requiresRestart ? setup?.restartReason || "Restart the server to load updated project paths." : ""}</p><div className="projects-actions"><button className="projects-btn" type="button" onClick={refresh}>Refresh status</button><button className="projects-btn projects-btn--primary" onClick={initializeProject}>Initialize folders</button><button className="projects-btn projects-btn--primary" type="button" onClick={() => generateDoctorPrompt(false)}>Generate Doctor prompt</button><button className="projects-btn" type="button" onClick={copyDoctorPrompt}>{doctorPrompt ? "Copy Doctor prompt" : "Generate & copy Doctor"}</button><input className="projects-input projects-starter-input" id="projects-starter-title" defaultValue="First HelmMate ticket" /><button className="projects-btn" onClick={createStarterTicket}>Create starter ticket</button></div>{doctorPrompt ? <div className="projects-prompt-wrap"><label className="projects-label" htmlFor="projects-doctor-prompt">Doctor prompt</label><textarea className="projects-textarea projects-prompt projects-doctor-prompt" id="projects-doctor-prompt" rows={14} readOnly value={doctorPrompt} /></div> : null}<span className="projects-status">{doctorStatus}</span></div></section>
        <div className="projects-grid">
          <section className="home-card projects-list-card"><div className="home-card-head"><h3>Project registry</h3></div><div className="home-card-body"><div className="projects-list">{ids.map((pid) => <button key={pid} className={`projects-list-item${pid === id ? " projects-list-item--selected" : ""}`} type="button" onClick={() => setSelectedId(pid)}><span className="projects-list-name">{data?.projects?.[pid]?.name || pid}</span><span className="projects-list-meta">{pid}{pid === data?.activeProject ? " · selected" : ""}{pid === data?.runtimeActiveProject ? " · running" : ""}</span></button>)}</div></div></section>
          <section className="home-card projects-editor-card" key={`editor-${id}`}><div className="home-card-head"><h3>Advanced config</h3><button className="projects-link-btn" type="button" onClick={() => setAdvancedOpen((v) => !v)}>{advancedOpen ? "Hide" : "Show"}</button></div><div className="home-card-body" hidden={!advancedOpen}>
            <div className="projects-form-grid"><ProjectField label="Project ID" id="projects-id" value={id} /><ProjectField label="Name" id="projects-name" value={selected.name || id} /><ProjectField label="Workspace" id="projects-workspace" value={selected.workspaceDir || "."} /><ProjectField label="Tickets" id="projects-tickets" value={selected.ticketsDir || "tickets"} /><ProjectField label="Ticket prefix" id="projects-prefix" value={selected.ticketIdPrefix || "DB"} /><ProjectField label="Agent dir" id="projects-agents" value={selected.agentDir || ".agents"} /><ProjectField label="Memory queue" id="projects-memory" value={selected.memoryQueueDir || "memory/sync-queue"} /><ProjectField label="Work prompt" id="projects-work-prompt" value={selected.workPrompt || "scripts/work-ticket-prompt.md"} /><ProjectField label="CI prompt" id="projects-ci-prompt" value={selected.fixCiPrompt || "scripts/fix-ci-prompt.md"} /><ProjectField label="Conflict prompt" id="projects-conflict-prompt" value={selected.fixConflictPrompt || "scripts/fix-conflict-prompt.md"} /></div>
            <label className="projects-label">Statuses</label><input className="projects-input" id="projects-statuses" defaultValue={statuses} /><label className="projects-label">Repos JSON</label><textarea className="projects-textarea" id="projects-repos" rows={10} defaultValue={JSON.stringify(repos, null, 2)} />
            <div className="projects-actions"><button className="projects-btn projects-btn--primary" onClick={saveSelected}>Save project</button><button className="projects-btn" onClick={activateSelected}>Set active</button><button className="projects-btn projects-btn--danger" onClick={deleteSelected}>Delete</button><button className="projects-btn" onClick={() => setSelectedId(`project-${ids.length + 1}`)}>New blank project</button></div>
          </div></section>
        </div>
      </div>
    </main>
  );
}

function ProjectField({ label, id, value }: { label: string; id: string; value: string }) {
  return <label className="projects-field"><span className="projects-label">{label}</span><input className="projects-input" id={id} type="text" defaultValue={value} key={`${id}-${value}`} /></label>;
}

function ProjectEngineField({ value }: { value: string }) {
  const selected = value || "unknown";
  return (
    <label className="projects-field">
      <span className="projects-label">Preferred engine</span>
      <select className="projects-input" id="projects-quick-engine" defaultValue={selected} key={`projects-quick-engine-${selected}`}>
        <option value="unknown">Not sure</option>
        <option value="claude">Claude Code</option>
        <option value="codex">Codex</option>
        <option value="opencode">OpenCode</option>
      </select>
    </label>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
