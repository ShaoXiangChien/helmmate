import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Sortable from "sortablejs";
import "../public/board.css";
import "../public/home.css";
import "../public/agents.css";

type AnyObj = Record<string, any>;

const TAB_KEY = "devboard.activeTab";
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
  if (!res.ok) throw new Error(`PATCH failed (${res.status})`);
  return res.json();
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
  if (/autopilot off/i.test(raw)) return "Autopilot is off";
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
      <div className="home-bar-fill" style={{ width: `${w}%` }} />
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

function App() {
  const [view, setViewState] = useState<View>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as View | null;
      return saved && VIEWS.includes(saved) ? saved : "board";
    } catch {
      return "board";
    }
  });
  const [config, setConfig] = useState<AnyObj | null>(null);
  const [tickets, setTickets] = useState<AnyObj[]>([]);
  const [board, setBoard] = useState<AnyObj>({ armed: false, autopilot: false, wipLimit: 2, running: [], defaultEngine: "claude" });
  const [readyOnly, setReadyOnly] = useState(false);
  const [toast, setToastState] = useState("");
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [onboardingRefreshKey, setOnboardingRefreshKey] = useState(0);

  const columns = useMemo(() => {
    const statuses = Array.isArray(config?.statuses) && config.statuses.length ? config.statuses : DEFAULT_COLUMNS.map((c) => c.status);
    return statuses.map((status: string) => ({ status, title: titleForStatus(status) }));
  }, [config]);
  const validRepos = useMemo(() => new Set(Array.isArray(config?.repos) && config.repos.length ? config.repos : ["workspace"]), [config]);
  const engines = useMemo(() => (Array.isArray(config?.engines) && config.engines.length ? config.engines : ["claude", "codex"]), [config]);
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
  const loadTickets = useCallback(async () => setTickets((await getJSON("/api/tickets")) || []), []);
  const loadBoardState = useCallback(async () => {
    const next = await getJSON("/api/state");
    if (next) setBoard(next);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadTickets(), loadBoardState()]);
  }, [loadConfig, loadTickets, loadBoardState]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  const boardDefaultEngine = useCallback(() => (engines.includes(board.defaultEngine) ? board.defaultEngine : "claude"), [engines, board.defaultEngine]);
  const resolveEngine = useCallback((t: AnyObj) => (t && engines.includes(t.engine) ? t.engine : boardDefaultEngine()), [engines, boardDefaultEngine]);
  const resolveRole = useCallback((t: AnyObj) => (t?.role && roleModel[t.role] ? t.role : roleByRepo[t?.repo] || "cross-repo"), [roleByRepo, roleModel]);
  const codexModel = useCallback((t: AnyObj) => (CODEX_MODELS.includes(t?.codex_model) ? t.codex_model : CODEX_MODEL_BY_ROLE[resolveRole(t)] || "gpt-5.4-mini"), [resolveRole]);
  const codexEffort = useCallback((t: AnyObj) => (CODEX_EFFORTS.includes(t?.codex_effort) ? t.codex_effort : CODEX_EFFORT_BY_ROLE[resolveRole(t)] || "medium"), [resolveRole]);

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
    try {
      const repo = Array.from(validRepos)[0] || "workspace";
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "First HelmMate ticket",
          repo,
          priority: "P2",
          status: "triage",
          description: "Created from the Board empty state.",
          acceptance_criteria: ["Ticket appears on the board"],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Create failed (${res.status})`);
      showToast(`${data.ticket?.id || "Ticket"} created`);
      await refresh();
    } catch (err: any) {
      showToast(err.message);
    }
  }, [validRepos, refresh, showToast]);

  const copyBoardSetupPrompt = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/agent-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "existing",
          projectId: config?.activeProject || "default",
          name: config?.activeProject || "Default",
          workspaceDir: config?.workspaceDir || ".",
          ticketIdPrefix: config?.ticketIdPrefix || "DB",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Prompt failed (${res.status})`);
      await navigator.clipboard.writeText(data.prompt || "");
      showToast("Setup prompt copied");
    } catch (err: any) {
      showToast(`Could not copy setup prompt: ${err.message}`);
    }
  }, [config, showToast]);

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
      showToast(`Default engine -> ${next}`);
    } catch (err: any) {
      showToast(err.message);
    }
  }, [boardDefaultEngine, engines, showToast]);

  const setView = useCallback((next: View) => {
    setViewState(VIEWS.includes(next) ? next : "board");
  }, []);

  const openTicket = openTicketId ? byId.get(openTicketId) : null;

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark" />
            <span className="brand-name">HelmMate</span>
          </div>
          <nav className="side-nav" role="tablist" aria-label="Views">
            {VIEWS.map((v) => (
              <button key={v} className={`side-tab${view === v ? " side-tab--active" : ""}`} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>
                <span className="side-tab-label">{titleForStatus(v)}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="app-main">
          <header className="topbar">
            <div className="topbar-controls">
              <div className="wip">WIP &middot; <span>{(board.running || []).length}</span>/<span>{board.wipLimit || 2}</span></div>
              <button className={`ghost-btn${readyOnly ? " ghost-btn--on" : ""}`} type="button" aria-pressed={readyOnly} title="Show ready tickets only" onClick={() => setReadyOnly((v) => !v)}>Ready</button>
              <button className={`arm ${board.armed ? "arm--on" : "arm--off"}`} type="button" aria-pressed={!!board.armed} onClick={() => setArmed(!board.armed)}>
                <span className="arm-dot" />
                <span className="arm-label">{board.armed ? "Armed" : "Disarmed"}</span>
              </button>
              <button className={`ghost-btn engine-toggle${boardDefaultEngine() === "codex" ? " engine-toggle--codex" : ""}`} type="button" title="Default engine for new launches" onClick={setDefaultEngine}>
                Engine: <span className="engine-label">{titleForStatus(boardDefaultEngine())}</span>
              </button>
              <button className="ghost-btn" type="button" title="Refresh board" onClick={refresh}>Refresh</button>
            </div>
          </header>

          <section className="view view-home" hidden={view !== "home"} role="tabpanel">
            <HomeView active={view === "home"} />
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
              moveTicket={moveTicket}
              openTicket={setOpenTicketId}
              stopSession={stopSession}
              resumeSession={resumeSession}
              setView={setView}
              createBoardStarterTicket={createBoardStarterTicket}
              copyBoardSetupPrompt={copyBoardSetupPrompt}
              showToast={showToast}
            />
            {openTicket ? (
              <TicketPanel
                ticket={openTicket}
                columns={columns}
                engines={engines}
                byId={byId}
                roleModel={roleModel}
                resolveRole={resolveRole}
                resolveEngine={resolveEngine}
                boardDefaultEngine={boardDefaultEngine}
                codexModel={codexModel}
                codexEffort={codexEffort}
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
      <Onboarding key={onboardingRefreshKey} refreshBoard={async () => { await refresh(); setOnboardingRefreshKey((v) => v + 1); }} setView={setView} />
      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}

function BoardView(props: AnyObj) {
  const {
    tickets, columns, readyOnly, isReady, isBlocked, isSessionRunning, isQueued, isSessionPaused,
    resolveRole, roleModel, resolveEngine, boardDefaultEngine, codexModel, codexEffort,
    moveTicket, openTicket, stopSession, resumeSession, setView, createBoardStarterTicket,
    copyBoardSetupPrompt, showToast,
  } = props;

  return (
    <main className="board">
      {tickets.length === 0 ? (
        <BoardEmptyState
          setView={setView}
          createBoardStarterTicket={createBoardStarterTicket}
          copyBoardSetupPrompt={copyBoardSetupPrompt}
          showToast={showToast}
        />
      ) : null}
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

function BoardEmptyState({ setView, createBoardStarterTicket, copyBoardSetupPrompt, showToast }: AnyObj) {
  return (
    <section className="board-empty" aria-label="Board empty state">
      <div className="board-empty-main">
        <span className="board-empty-kicker">No tickets yet</span>
        <h1>Start with a reviewed first ticket.</h1>
        <p>HelmMate is disarmed by default. Connect an existing repo, create a small starter ticket, or copy the setup prompt before any agent work can run.</p>
      </div>
      <div className="board-empty-actions">
        <button className="board-empty-btn board-empty-btn--primary" type="button" onClick={() => setView("projects")}>Connect existing repo</button>
        <button className="board-empty-btn" type="button" onClick={createBoardStarterTicket}>Create ticket</button>
        <button className="board-empty-btn" type="button" onClick={() => showToast("Import from notes is planned next; use Create ticket for now")}>Import from notes</button>
        <button className="board-empty-btn" type="button" onClick={copyBoardSetupPrompt}>Copy setup prompt</button>
        <button className="board-empty-btn" type="button" onClick={() => showToast("Doctor is not wired yet; open Projects for setup readiness")}>Run doctor</button>
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

function RoleTag({ ticket, resolveRole, roleModel, resolveEngine, codexModel, codexEffort }: AnyObj) {
  const role = resolveRole(ticket);
  const derived = !ticket?.role;
  if (resolveEngine(ticket) === "codex") {
    const model = codexModel(ticket);
    const effort = codexEffort(ticket);
    const title = `agent: ${role}${derived ? " (derived from repo)" : " (explicit)"} · codex model: ${model} · effort: ${effort}`;
    return <span className="tag tag-role tag-role--codex" title={title}>{role} · {String(model).replace(/^gpt-/, "")}/{effort}</span>;
  }
  const model = ticket?.model || roleModel[role] || "sonnet";
  const opus = /opus/i.test(model);
  return <span className={`tag tag-role${opus ? " tag-role--opus" : ""}`} title={`agent: ${role} · model: ${model}${derived ? " (derived from repo)" : " (explicit)"}`}>{role}{opus ? " · opus" : ""}</span>;
}

function EngineTag({ ticket, resolveEngine, boardDefaultEngine }: AnyObj) {
  const engine = resolveEngine(ticket);
  if (engine !== "codex" && engine === boardDefaultEngine()) return null;
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
    <div className={`card${blocked ? " blocked" : ""}${running ? " running" : ""}${queued ? " queued" : ""}${paused ? " paused" : ""}`} data-id={ticket.id} onClick={() => openTicket(ticket.id)}>
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

function TicketPanel(props: AnyObj) {
  const {
    ticket, columns, engines, byId, resolveRole, resolveEngine, boardDefaultEngine, codexModel,
    codexEffort, isSessionRunning, isQueued, isSessionPaused, moveTicket, close, refresh, showToast,
    stopSession, resumeSession,
  } = props;
  const [log, setLog] = useState("loading...");

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

  return (
    <>
      <div className="panel-overlay" onClick={close} />
      <aside className="panel" aria-hidden="false">
        <button className="panel-close" type="button" aria-label="Close" onClick={close}>&times;</button>
        <div className="panel-body">
          <span className="panel-id">{ticket.id} &middot; {ticket.status}{ticket.origin ? ` · ↳ from ${ticket.origin}` : ""}</span>
          <h2>{ticket.title}</h2>
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
              <option value="">Board default ({boardDefaultEngine()})</option>
              {engines.map((engine: string) => <option key={engine} value={engine}>{titleForStatus(engine)}</option>)}
            </select>
            <p className="panel-hint">Codex runs on your ChatGPT plan - use it when Claude usage is exhausted.</p>
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

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="panel-section"><h3>{title}</h3>{children}</div>;
}

function HomeView({ active }: { active: boolean }) {
  const [usage, setUsage] = useState<AnyObj | null>(null);
  const [scheduler, setScheduler] = useState<AnyObj | null>(null);
  const [runs, setRuns] = useState<AnyObj[] | null>(null);
  const [now, setNow] = useState(Date.now());

  const poll = useCallback(async () => {
    const [u, s, r] = await Promise.all([getJSON("/api/usage"), getJSON("/api/scheduler"), getJSON("/api/runs")]);
    setUsage(u);
    setScheduler(s);
    setRuns(Array.isArray(r) ? r : r == null ? null : []);
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

  return (
    <main className="home">
      {breaker?.tripped ? (
        <div className="home-breaker" role="alert">
          <div className="home-breaker-main">
            <span className="home-breaker-flag">Usage paused</span>
            <span className="home-breaker-reason">{shortReason(breaker.reason)}. Auto-dispatch is off until <strong>{breaker.until ? new Date(breaker.until).toLocaleTimeString() : "manual reset"}</strong>.</span>
          </div>
          <button className="home-breaker-reset" type="button" onClick={resetBreaker}>Reset breaker</button>
        </div>
      ) : null}
      <div className="home-grid">
        <HomeCard title="5h Block Usage" sub={usage?.asOf ? relTime(usage.asOf) : ""}>
          {!usage || !block ? <p className="home-empty">No usage data. <span className="home-na">/api/usage</span> not available.</p> : !official ? (
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

        <HomeCard title={usage?.codex ? "Codex Usage" : "Burn Rate"} sub={usage?.codex?.asOf ? relTime(usage.codex.asOf) : ""}>
          {usage?.codex ? (
            <>
              <div className="home-big home-big--sm"><span className="home-big-num">{fmtPct(usage.codex.primary?.pct)}</span><span className="home-big-label">5h window</span></div>
              <Gauge pct={usage.codex.primary?.pct} />
              <div className="home-dispatch-grid">
                <MetricRow label="7d window">{fmtPct(usage.codex.secondary?.pct)}</MetricRow>
                <MetricRow label="resets">{untilTime(usage.codex.primary?.resetTime)}</MetricRow>
                <MetricRow label="plan">{usage.codex.planType || "Codex"}</MetricRow>
                <MetricRow label="source"><span className="home-src home-src--live">local</span></MetricRow>
              </div>
            </>
          ) : (
            <>
              <div className="home-big home-big--sm"><span className="home-big-num">{fmtTokens(block?.burnTokensPerMin)}</span><span className="home-big-label">tokens / min <span className="home-dim">(local)</span></span></div>
              <div className="home-note">local trend signal only</div>
            </>
          )}
        </HomeCard>

        <HomeCard title="Weekly Usage">
          {!weekly ? <p className="home-empty">No weekly data.</p> : weekly.source !== "official" ? (
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

        <HomeCard title="Dispatch">
          {!scheduler ? <p className="home-empty">Scheduler offline. <span className="home-na">/api/scheduler</span> not available.</p> : (
            <>
              <div className="home-dispatch-top">
                <span className={`home-pill ${!scheduler.autopilot ? "home-pill--off" : "home-pill--on"}`}>{scheduler.autopilot ? "ON" : "OFF"}</span>
                <button type="button" className={`home-toggle ${scheduler.autopilot ? "home-toggle--on" : "home-toggle--off"}`} onClick={toggleAutopilot}>
                  <span className="home-toggle-dot" />{scheduler.autopilot ? "Autopilot ON" : "Autopilot OFF"}
                </button>
              </div>
              <div className="home-dispatch-grid">
                <MetricRow label="mode">{scheduler.mode === "night" ? "Night" : "Day"}{scheduler.nightOnly ? " · night-only" : ""}</MetricRow>
                <MetricRow label="active cap">{fmtFractionPct(scheduler.activeCapPct)}</MetricRow>
                <MetricRow label="next poll">{num(scheduler.nextPollInSec) != null ? fmtMin(num(scheduler.nextPollInSec)! / 60) : "-"}</MetricRow>
                <MetricRow label="WIP limit">{fmtInt(scheduler.wipLimit)}</MetricRow>
              </div>
              <div className="home-sub-head">Recent decisions</div>
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
            </>
          )}
        </HomeCard>

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

  async function resolveQueue(id: string, action: string) {
    await fetch(`/api/memory-queue/${encodeURIComponent(id)}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).catch(() => null);
    refresh();
  }

  const usage = data?.usage || {};
  const pending = Array.isArray(queue?.pending) ? queue.pending : [];
  return (
    <main className="agents">
      <div className="agents-view">
        <div className="agents-header"><h2 className="agents-title">Agents</h2><button className="agents-refresh-btn" type="button" onClick={refresh}>Refresh</button></div>
        {!data ? <p className="agents-error home-empty"><span className="home-na">/api/agents</span> not available - check server.</p> : null}
        <section className="home-card agents-queue-card">
          <div className="home-card-head"><h3>Memory proposals</h3><span className={`agents-queue-count${pending.length ? " agents-queue-count--has" : ""}`}>{pending.length ? `${pending.length} pending` : "none pending"}</span></div>
          <div className="home-card-body">
            {!pending.length ? <p className="home-empty">No pending proposals. Autonomous sessions drop durable learnings in <span className="home-na">memory/sync-queue/</span> for review; they appear here.</p> : pending.map((p: AnyObj) => (
              <div className="agents-queue-item" key={p.id}>
                <div className="agents-queue-item-head"><span className="agents-queue-id">{p.id}</span><span className="agents-queue-meta">{fmtInt(p.proposalCount)} proposals</span><span className="agents-queue-actions"><button className="agents-queue-btn" onClick={() => resolveQueue(p.id, "archive")}>Archive</button><button className="agents-queue-btn agents-queue-btn--dismiss" onClick={() => resolveQueue(p.id, "dismiss")}>Dismiss</button></span></div>
                <details className="agents-queue-details"><summary>view proposal</summary><pre className="agents-queue-pre">{p.content}</pre></details>
              </div>
            ))}
          </div>
        </section>
        {data ? (
          <>
            <div className="agents-spend-section">
              <SpendCard title="Spend by model" buckets={usage.byModel} kind="model" />
              <SpendCard title="Spend by role" buckets={usage.byRole} kind="role" />
              <SpendCard title="Spend by engine" buckets={usage.byEngine} kind="engine" hint="Codex bills against your ChatGPT plan - tokens are tracked, cost shows n/a." />
            </div>
            <div className="agents-editor-grid">{(data.agents || []).map((agent: AnyObj) => <AgentEditor key={agent.role} agent={agent} usageByRole={usage.byRole || {}} codexConfig={data.codex || {}} refresh={refresh} />)}</div>
          </>
        ) : null}
      </div>
    </main>
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

function AgentEditor({ agent, usageByRole, codexConfig, refresh }: AnyObj) {
  const [description, setDescription] = useState(agent.description || "");
  const [model, setModel] = useState(agent.model || "sonnet");
  const [body, setBody] = useState(agent.body || "");
  const [status, setStatus] = useState("");
  const roleUsage = usageByRole?.[agent.role];
  const m = String(agent.model || "").toLowerCase();
  const badge = m.includes("sonnet") ? "agents-badge--sonnet" : m.includes("opus") ? "agents-badge--opus" : m.includes("haiku") ? "agents-badge--haiku" : "agents-badge--dim";

  async function save() {
    setStatus("Saving...");
    const res = await fetch(`/api/agents/${encodeURIComponent(agent.role)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description, model, body }) });
    if (res.ok) {
      setStatus("saved");
      refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      setStatus(`error: ${e.error || res.status}`);
    }
  }

  return (
    <section className="home-card agents-editor-card">
      <div className="home-card-head"><h3>{agent.role}</h3><span className={`agents-badge ${badge}`}>{agent.model || "unknown"}</span></div>
      <div className="home-card-body">
        <div className="agents-runs-line">{roleUsage ? `${fmtInt(roleUsage.runs)} runs · ${fmtUSD(roleUsage.cost_usd, roleUsage.has_cost)}` : "no runs yet"}</div>
        {codexConfig.modelByRole?.[agent.role] ? <div className="agents-codex-line">Codex default: <span>{codexConfig.modelByRole[agent.role]}</span> · <span>{codexConfig.effortByRole?.[agent.role] || "medium"}</span></div> : null}
        <div className="agents-field-row"><label className="agents-label">model</label><select className="agents-select" value={model} onChange={(e) => setModel(e.target.value)}>{["sonnet", "opus", "haiku"].map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
        <div className="agents-field-col"><label className="agents-label">description</label><input className="agents-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One-line persona description..." /></div>
        <div className="agents-field-col"><label className="agents-label">body</label><textarea className="agents-textarea" rows={14} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown body (everything after frontmatter)..." /></div>
        <div className="agents-save-row"><button className="agents-save-btn" type="button" onClick={save}>Save</button><span className="agents-status">{status}</span></div>
        <div className="agents-path home-note">{agent.path || ""}</div>
      </div>
    </section>
  );
}

function ProjectsView({ active, refreshBoard, setView }: { active: boolean; refreshBoard: () => Promise<void>; setView: (v: View) => void }) {
  const [data, setData] = useState<AnyObj | null>(null);
  const [setup, setSetup] = useState<AnyObj | null>(null);
  const [selectedId, setSelectedId] = useState("default");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    const [d, s] = await Promise.all([getJSON("/api/projects"), getJSON("/api/setup/status")]);
    setData(d);
    setSetup(s);
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
    const fallback = (name || path.split("/").filter(Boolean).pop() || "default").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return {
      id: (document.getElementById("projects-quick-id") as HTMLInputElement)?.value.trim() || fallback,
      name: name || fallback,
      workspaceDir: path,
      ticketIdPrefix: ((document.getElementById("projects-quick-prefix") as HTMLInputElement)?.value.trim() || "DB").toUpperCase(),
    };
  }

  function quickPayload() {
    const q = quickValues();
    return {
      name: q.name,
      workspaceDir: q.workspaceDir,
      ticketsDir: "tickets",
      ticketIdPrefix: q.ticketIdPrefix,
      agentDir: ".agents",
      memoryQueueDir: "memory/sync-queue",
      workPrompt: "scripts/work-ticket-prompt.md",
      fixCiPrompt: "scripts/fix-ci-prompt.md",
      fixConflictPrompt: "scripts/fix-conflict-prompt.md",
      statuses: ["triage", "backlog", "queued", "in_progress", "blocked", "human_review", "done"],
      repos: { workspace: { path: ".", baseBranch: "main", worktree: false, role: "cross-repo" } },
      engines: { default: "claude", allowed: ["claude", "codex"] },
    };
  }

  async function saveQuick(kind: string) {
    const q = quickValues();
    const res = await fetch(`/api/projects/${encodeURIComponent(q.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quickPayload()) });
    if (res.ok) {
      setData(await res.json());
      setSelectedId(q.id);
      setStatus(kind === "new" ? "New project defaults saved." : "Existing repo imported.");
    }
  }

  async function copyAgentPrompt() {
    const q = quickValues();
    const res = await fetch("/api/setup/agent-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "existing", projectId: q.id, name: q.name, workspaceDir: q.workspaceDir, ticketIdPrefix: q.ticketIdPrefix }) });
    const body = await res.json();
    await navigator.clipboard.writeText(body.prompt || "");
    setStatus("Copied setup prompt.");
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

  return (
    <main className="projects">
      <div className="projects-view">
        <div className="agents-header"><h2 className="agents-title">Projects</h2><button className="agents-refresh-btn" type="button" onClick={refresh}>Refresh</button></div>
        {data?.requiresRestartToSwitch ? <div className="home-breaker projects-restart"><div className="home-breaker-main"><span className="home-breaker-flag">Restart needed</span><span className="home-breaker-reason">The selected active project differs from the project currently loaded by the server.</span></div></div> : null}
        <section className="home-card projects-guided-card" key={`guided-${id}`}><div className="home-card-head"><h3>Guided setup</h3><span className="home-card-sub">quick start</span></div><div className="home-card-body">
          <div className="projects-form-grid projects-quick-grid"><ProjectField label="Project ID" id="projects-quick-id" value={id} /><ProjectField label="Name" id="projects-quick-name" value={selected.name || id} /><ProjectField label="Workspace path" id="projects-quick-path" value={selected.workspaceDir || "."} /><ProjectField label="Ticket prefix" id="projects-quick-prefix" value={selected.ticketIdPrefix || "DB"} /></div>
          <div className="projects-flow-grid"><div className="projects-flow"><span className="projects-flow-kicker">Existing repo</span><span className="projects-flow-main">Import repo defaults</span><button className="projects-btn projects-btn--primary" onClick={() => saveQuick("existing")}>Import existing repo</button></div><div className="projects-flow"><span className="projects-flow-kicker">New project</span><span className="projects-flow-main">Create clean defaults</span><button className="projects-btn" onClick={() => saveQuick("new")}>Save new project</button></div><div className="projects-flow projects-flow--agent"><span className="projects-flow-kicker">Agent setup</span><span className="projects-flow-main">Use helm-setup-project</span><button className="projects-btn" onClick={copyAgentPrompt}>Copy setup prompt</button></div></div>
          <p className="projects-note">Advanced config stays below for multi-repo projects, custom prompts, and nonstandard statuses.</p><span className="projects-status">{status}</span>
        </div></section>
        <section className="home-card projects-setup-card"><div className="home-card-head"><h3>Setup assistant</h3><span className="home-card-sub">{setup?.ready ? "ready" : "needs setup"}</span></div><div className="home-card-body"><ul className="projects-steps">{["Tickets directory", "Ticket index", "Configured repo", "Agent directory", "Memory queue"].map((label, idx) => {
          const ok = idx === 0 ? setup?.ticketsDirExists : idx === 1 ? setup?.indexExists : idx === 2 ? (setup?.repos || []).length > 0 : idx === 3 ? setup?.agentDirExists : setup?.memoryQueueDirExists;
          const detail = idx === 0 ? setup?.ticketsDir : idx === 1 ? (setup?.indexExists ? "_index.json exists" : "will be created") : idx === 2 ? (setup?.repos || []).join(", ") || "none" : idx === 3 ? setup?.agentDir : setup?.memoryQueueDir;
          return <li key={label} className={ok ? "projects-step projects-step--done" : "projects-step"}><span className="projects-step-dot" /><span className="projects-step-main">{label}</span><span className="projects-step-detail">{detail || "not configured"}</span></li>;
        })}</ul><div className="projects-actions"><button className="projects-btn projects-btn--primary" onClick={initializeProject}>Initialize folders</button><input className="projects-input projects-starter-input" id="projects-starter-title" defaultValue="First HelmMate ticket" /><button className="projects-btn" onClick={createStarterTicket}>Create starter ticket</button></div></div></section>
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

function Onboarding({ refreshBoard, setView }: { refreshBoard: () => Promise<void>; setView: (v: View) => void }) {
  const [setup, setSetup] = useState<AnyObj | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    (async () => {
      const s = await getJSON("/api/setup/status");
      setSetup(s);
      const key = `devboard.onboarding.dismissed.${s?.activeProject || "default"}`;
      let dismissed = false;
      try { dismissed = localStorage.getItem(key) === "1"; } catch { /* ignore */ }
      setHidden(dismissed || (!!s?.ready && s.ticketCount !== 0));
    })();
  }, []);

  function dismiss() {
    try { localStorage.setItem(`devboard.onboarding.dismissed.${setup?.activeProject || "default"}`, "1"); } catch { /* ignore */ }
    setHidden(true);
  }

  async function initialize() {
    await fetch("/api/setup/init", { method: "POST" }).catch(() => null);
    setSetup(await getJSON("/api/setup/status"));
    setHidden(false);
  }

  async function createTicket() {
    const title = (document.getElementById("onboarding-title") as HTMLInputElement)?.value.trim() || "First HelmMate ticket";
    const res = await fetch("/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, repo: setup?.repos?.[0] || "workspace", priority: "P2", status: "triage", description: "Created from the onboarding overlay.", acceptance_criteria: ["Ticket appears on the board"] }) }).catch(() => null);
    if (res?.ok) {
      dismiss();
      await refreshBoard();
      setView("board");
    }
  }

  if (hidden || !setup) return null;
  return (
    <div className="onboarding">
      <div className="onboarding-backdrop" />
      <section className="onboarding-panel" role="dialog" aria-modal="true" aria-label="Set up HelmMate">
        <div className="onboarding-head"><div><span className="onboarding-kicker">First run</span><h2>Set up your local board</h2></div><button className="onboarding-close" type="button" aria-label="Close" onClick={dismiss}>&times;</button></div>
        <p className="onboarding-copy">HelmMate starts disarmed. Set up local folders, create a first ticket, then arm the board only when you want agent launches.</p>
        <ul className="onboarding-steps">
          <li className={setup.ticketsDirExists ? "onboarding-step onboarding-step--done" : "onboarding-step"}><span className="onboarding-dot" /><span className="onboarding-step-label">Tickets directory</span><span className="onboarding-step-detail">{setup.ticketsDir || "not configured"}</span></li>
          <li className={setup.indexExists ? "onboarding-step onboarding-step--done" : "onboarding-step"}><span className="onboarding-dot" /><span className="onboarding-step-label">Ticket index</span><span className="onboarding-step-detail">{setup.indexExists ? "_index.json exists" : "will be created"}</span></li>
          <li className={(setup.repos || []).length > 0 ? "onboarding-step onboarding-step--done" : "onboarding-step"}><span className="onboarding-dot" /><span className="onboarding-step-label">Configured repo</span><span className="onboarding-step-detail">{(setup.repos || []).join(", ") || "none"}</span></li>
        </ul>
        <div className="onboarding-ticket-row"><input className="projects-input" id="onboarding-title" defaultValue="First HelmMate ticket" /><button className="projects-btn" type="button" onClick={createTicket}>Create ticket</button></div>
        <div className="onboarding-actions"><button className="projects-btn projects-btn--primary" type="button" onClick={initialize}>Initialize folders</button><button className="projects-btn" type="button" onClick={() => { dismiss(); setView("projects"); }}>Open Projects</button><button className="projects-btn" type="button" onClick={dismiss}>Skip</button></div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
