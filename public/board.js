// HelmMate front end — vanilla JS, SortableJS for drag-and-drop.

let COLUMNS = [
  { status: "triage", title: "Triage" },
  { status: "backlog", title: "Backlog" },
  { status: "queued", title: "Queued" },
  { status: "in_progress", title: "In Progress" },
  { status: "blocked", title: "Blocked" },
  { status: "human_review", title: "Human Review" },
  { status: "done", title: "Done" },
];

let VALID_REPOS = new Set(["workspace"]);
let ENGINES = ["claude", "codex"];

const state = {
  tickets: [],
  byId: new Map(),
  board: { armed: false, wipLimit: 2, running: [], defaultEngine: "claude" },
  openTicketId: null,
  logTimer: null,
  readyOnly: false,
  config: null,
};

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function depsUnmet(ticket) {
  const deps = Array.isArray(ticket.depends_on) ? ticket.depends_on : [];
  return deps.filter((id) => {
    const dep = state.byId.get(id);
    return !dep || dep.status !== "done";
  });
}

function isBlocked(ticket) {
  return ticket.status === "blocked" || depsUnmet(ticket).length > 0;
}

function hasAcceptanceCriteria(ticket) {
  return Array.isArray(ticket.acceptance_criteria) && ticket.acceptance_criteria.length > 0;
}

function isReady(ticket) {
  if (!["triage", "backlog"].includes(ticket.status)) return false;
  if (state.board.running.includes(ticket.id)) return false;
  if (depsUnmet(ticket).length > 0) return false;
  if (!VALID_REPOS.has(ticket.repo)) return false;
  if (ticket.status !== "triage" && !hasAcceptanceCriteria(ticket)) return false;
  return true;
}

let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

// ---------- data ----------
function titleForStatus(status) {
  return String(status || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    state.config = cfg;
    if (Array.isArray(cfg.statuses) && cfg.statuses.length) {
      COLUMNS = cfg.statuses.map((status) => ({ status, title: titleForStatus(status) }));
    }
    if (Array.isArray(cfg.repos) && cfg.repos.length) VALID_REPOS = new Set(cfg.repos);
    if (Array.isArray(cfg.engines) && cfg.engines.length) ENGINES = cfg.engines;
    if (cfg.roleByRepo && typeof cfg.roleByRepo === "object") ROLE_BY_REPO = cfg.roleByRepo;
    if (cfg.roles && typeof cfg.roles === "object") {
      ROLE_MODEL = Object.fromEntries(
        Object.entries(cfg.roles).map(([role, value]) => [role, value && value.model ? value.model : "sonnet"])
      );
    }
  } catch {
    state.config = null;
  }
}

async function loadTickets() {
  try {
    const res = await fetch("/api/tickets");
    state.tickets = await res.json();
  } catch {
    state.tickets = [];
    toast("Could not load tickets");
  }
  state.byId = new Map(state.tickets.map((t) => [t.id, t]));
}

async function loadBoardState() {
  try {
    const res = await fetch("/api/state");
    state.board = await res.json();
  } catch {
    /* keep last known */
  }
  renderHeader();
}

async function patchTicket(id, patch) {
  const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH failed (${res.status})`);
  return res.json();
}

function isSessionRunning(id) {
  return Array.isArray(state.board.running) && state.board.running.includes(id);
}

function isQueued(ticket) {
  return ticket && ticket.status === "queued" && !isSessionRunning(ticket.id);
}

// True when a ticket was paused mid-run by a usage limit (not currently running).
function isSessionPaused(ticket) {
  return (
    !!ticket.last_run_limit_hit &&
    (ticket.status === "in_progress" || ticket.status === "backlog" || ticket.status === "queued") &&
    !isSessionRunning(ticket.id)
  );
}

function launchToast(id, result) {
  const r = result && result.launch;
  if (!r) return false;
  if (r.launched) toast(`${id} launched (pid ${r.pid})`);
  else if (r.reason === "disarmed") toast(`${id} queued — board is disarmed`);
  else if (r.reason === "blocked") toast(`${id} blocked — deps not done`);
  else if (r.reason === "preflight_failed") toast(`${id} blocked — preflight failed`);
  else if (r.reason === "wip_limit") toast(`${id} queued — WIP limit reached`);
  else if (r.reason === "already_running") toast(`${id} already running`);
  else toast(`${id} not launched (${r.reason})`);
  return true;
}

// Resume a paused-on-limit session. Reuses the existing worktree + branch.
async function resumeSession(id) {
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/resume`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.launched) toast(`${id} resumed (pid ${data.pid})`);
    else if (data.reason === "disarmed") toast(`${id} not resumed — board is disarmed`);
    else if (data.reason === "wip_limit") toast(`${id} not resumed — WIP limit reached`);
    else toast(`${id} not resumed — ${data.reason || data.error || res.status}`);
  } catch (err) {
    toast(`resume failed: ${err.message}`);
  }
  await loadTickets();
  await loadBoardState();
  renderBoard();
  if (state.openTicketId === id) openPanel(state.openTicketId);
}

// Kill the running session for a ticket. Confirms first (irreversible), POSTs to
// the stop endpoint, then refreshes the board + open panel.
async function stopSession(id) {
  if (!confirm(`Stop the running session for ${id}? This kills the agent process and reverts the ticket to Backlog.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/stop`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.stopped) toast(`${id} session stopped (pid ${data.pid})`);
    else toast(`${id} not stopped — ${data.reason || res.status}`);
  } catch (err) {
    toast(`stop failed: ${err.message}`);
  }
  await loadTickets();
  await loadBoardState();
  renderBoard();
  if (state.openTicketId === id) openPanel(state.openTicketId);
}

async function setArmed(armed) {
  const res = await fetch("/api/arm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ armed }),
  });
  state.board = await res.json();
  renderHeader();
}

// Flip the board-wide default engine. Re-renders the board so per-card engine
// chips update.
async function setBoardDefaultEngine(engine) {
  try {
    const res = await fetch("/api/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine }),
    });
    if (!res.ok) throw new Error(`engine set failed (${res.status})`);
    state.board = await res.json();
    toast(`Default engine → ${engine}`);
  } catch (err) {
    toast(err.message);
    await loadBoardState();
  }
  renderHeader();
  renderBoard();
}

// ---------- render: header ----------
function renderHeader() {
  $("#wip-count").textContent = state.board.running.length;
  $("#wip-limit").textContent = state.board.wipLimit;

  const btn = $("#arm-toggle");
  const label = btn.querySelector(".arm-label");
  if (state.board.armed) {
    btn.classList.add("arm--on");
    btn.classList.remove("arm--off");
    btn.setAttribute("aria-pressed", "true");
    label.textContent = "Armed";
  } else {
    btn.classList.add("arm--off");
    btn.classList.remove("arm--on");
    btn.setAttribute("aria-pressed", "false");
    label.textContent = "Disarmed";
  }

  const readyBtn = $("#ready-toggle");
  readyBtn.classList.toggle("ghost-btn--on", state.readyOnly);
  readyBtn.setAttribute("aria-pressed", state.readyOnly ? "true" : "false");

  const engineBtn = $("#engine-toggle");
  if (engineBtn) {
    const def = boardDefaultEngine();
    const label = engineBtn.querySelector(".engine-label");
    if (label) label.textContent = titleForStatus(def);
    engineBtn.classList.toggle("engine-toggle--codex", def === "codex");
  }
}

// ---------- render: board ----------
function priorityPill(p) {
  const cls = p === "P0" ? "pill-p0" : p === "P1" ? "pill-p1" : "pill-p2";
  return `<span class="pill ${cls}">${escapeHtml(p || "P2")}</span>`;
}

// Display mirror of lib/roles.js (which agent + model will work this ticket).
// Config loading updates these defaults when /api/config is available.
let ROLE_BY_REPO = { workspace: "cross-repo" };
let ROLE_MODEL = { "cross-repo": "sonnet", architect: "opus" };
const CODEX_MODEL_BY_ROLE = {
  "ios-engineer": "gpt-5.4-mini",
  "backend-engineer": "gpt-5.4-mini",
  "cross-repo": "gpt-5.3-codex",
  "architect": "gpt-5.5",
};
const CODEX_EFFORT_BY_ROLE = {
  "ios-engineer": "medium",
  "backend-engineer": "medium",
  "cross-repo": "high",
  "architect": "high",
};
const CODEX_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"];
const CODEX_EFFORTS = ["low", "medium", "high", "xhigh"];
function resolveRole(t) {
  if (t && t.role && ROLE_MODEL[t.role]) return t.role;
  return (t && ROLE_BY_REPO[t.repo]) || "cross-repo";
}
function effectiveModel(t) {
  if (t && t.model) return t.model;
  return ROLE_MODEL[resolveRole(t)] || "sonnet";
}
function codexModel(t) {
  if (t && CODEX_MODELS.includes(t.codex_model)) return t.codex_model;
  return CODEX_MODEL_BY_ROLE[resolveRole(t)] || "gpt-5.4-mini";
}
function codexEffort(t) {
  if (t && CODEX_EFFORTS.includes(t.codex_effort)) return t.codex_effort;
  return CODEX_EFFORT_BY_ROLE[resolveRole(t)] || "medium";
}
function shortCodexModel(model) {
  return String(model || "").replace(/^gpt-/, "");
}
function roleTag(t) {
  const role = resolveRole(t);
  const derived = !(t && t.role);
  if (resolveEngine(t) === "codex") {
    const model = codexModel(t);
    const effort = codexEffort(t);
    const modelSource = t && t.codex_model ? "ticket override" : "role default";
    const effortSource = t && t.codex_effort ? "ticket override" : "role default";
    const title =
      `agent: ${role}${derived ? " (derived from repo)" : " (explicit)"} · ` +
      `codex model: ${model} (${modelSource}) · effort: ${effort} (${effortSource})`;
    return `<span class="tag tag-role tag-role--codex" title="${escapeHtml(title)}">${escapeHtml(role)} · ${escapeHtml(shortCodexModel(model))}/${escapeHtml(effort)}</span>`;
  }
  const model = effectiveModel(t);
  const opus = /opus/i.test(model);
  const title = `agent: ${role} · model: ${model}${derived ? " (derived from repo)" : " (explicit)"}`;
  return `<span class="tag tag-role${opus ? " tag-role--opus" : ""}" title="${escapeHtml(title)}">${escapeHtml(role)}${opus ? " · opus" : ""}</span>`;
}

// Which CLI works this ticket: an explicit, KNOWN ticket.engine wins; else the
function boardDefaultEngine() {
  return ENGINES.includes(state.board.defaultEngine) ? state.board.defaultEngine : "claude";
}
function resolveEngine(t) {
  if (t && ENGINES.includes(t.engine)) return t.engine;
  return boardDefaultEngine();
}
// A chip when Codex is active or when the ticket differs from the board default.
function engineTag(t) {
  const engine = resolveEngine(t);
  if (engine !== "codex" && engine === boardDefaultEngine()) return "";
  const pinned = !!(t && ENGINES.includes(t.engine));
  const title = `engine: ${engine}${pinned ? " (pinned on ticket)" : " (board default)"}`;
  return `<span class="tag tag-engine tag-engine--${engine}" title="${escapeHtml(title)}">${escapeHtml(engine)}</span>`;
}

function firstRepo() {
  return Array.from(VALID_REPOS)[0] || "workspace";
}

async function createBoardStarterTicket() {
  try {
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "First HelmMate ticket",
        repo: firstRepo(),
        priority: "P2",
        status: "triage",
        description: "Created from the Board empty state.",
        acceptance_criteria: ["Ticket appears on the board"],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Create failed (${res.status})`);
    toast(`${data.ticket?.id || "Ticket"} created`);
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function copyBoardSetupPrompt() {
  try {
    const res = await fetch("/api/setup/agent-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "existing",
        projectId: state.config?.activeProject || "default",
        name: state.config?.activeProject || "Default",
        workspaceDir: state.config?.workspaceDir || ".",
        ticketIdPrefix: state.config?.ticketIdPrefix || "DB",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Prompt failed (${res.status})`);
    await navigator.clipboard.writeText(data.prompt || "");
    toast("Setup prompt copied");
  } catch (err) {
    toast(`Could not copy setup prompt: ${err.message}`);
  }
}

function boardEmptyStateHtml() {
  return `
    <section class="board-empty" aria-label="Board empty state">
      <div class="board-empty-main">
        <span class="board-empty-kicker">No tickets yet</span>
        <h1>Start with a reviewed first ticket.</h1>
        <p>
          HelmMate is disarmed by default. Connect an existing repo, create a small starter ticket,
          or copy the setup prompt before any agent work can run.
        </p>
      </div>
      <div class="board-empty-actions">
        <button class="board-empty-btn board-empty-btn--primary" type="button" data-board-action="projects">
          Connect existing repo
        </button>
        <button class="board-empty-btn" type="button" data-board-action="create-ticket">Create ticket</button>
        <button class="board-empty-btn" type="button" data-board-action="import-notes">Import from notes</button>
        <button class="board-empty-btn" type="button" data-board-action="copy-setup">Copy setup prompt</button>
        <button class="board-empty-btn" type="button" data-board-action="doctor">Run doctor</button>
      </div>
    </section>`;
}

function columnHint(status) {
  if (state.tickets.length === 0) return "";
  if (state.readyOnly && status === "backlog") return "No ready backlog tickets match the filter.";
  const hints = {
    triage: "No new tickets waiting for review.",
    backlog: "No tickets ready to queue.",
    queued: "No launch requests waiting.",
    in_progress: "No agent sessions running.",
    blocked: "No blocked tickets.",
    human_review: "No handoffs waiting.",
    done: "Nothing completed yet.",
  };
  return hints[status] || "";
}

function wireBoardEmptyActions() {
  document.querySelectorAll("[data-board-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-board-action");
      if (action === "projects") {
        if (window.devboardSetView) window.devboardSetView("projects");
        return;
      }
      if (action === "create-ticket") {
        createBoardStarterTicket();
        return;
      }
      if (action === "copy-setup") {
        copyBoardSetupPrompt();
        return;
      }
      if (action === "import-notes") {
        toast("Import from notes is planned next; use Create ticket for now");
        return;
      }
      if (action === "doctor") {
        toast("Doctor is not wired yet; open Projects for setup readiness");
      }
    });
  });
}

function cardHtml(t) {
  const blocked = isBlocked(t);
  const ready = isReady(t);
  const running = isSessionRunning(t.id);
  const queued = isQueued(t);
  const paused = isSessionPaused(t);
  return `
    <div class="card${blocked ? " blocked" : ""}${running ? " running" : ""}${queued ? " queued" : ""}${paused ? " paused" : ""}" data-id="${escapeHtml(t.id)}">
      <div class="card-top">
        <span class="card-id">${escapeHtml(t.id)}</span>
        ${priorityPill(t.priority)}
        ${blocked ? '<span class="badge-blocked">blocked</span>' : ""}
        ${ready ? '<span class="badge-ready">ready</span>' : ""}
        ${queued ? '<span class="badge-queued">queued</span>' : ""}
        ${running ? '<span class="badge-running">● running</span>' : ""}
        ${paused ? '<span class="badge-paused">⏸ paused</span>' : ""}
      </div>
      <p class="card-title">${escapeHtml(t.title)}</p>
      <div class="card-meta">
        ${t.origin ? `<span class="tag tag-origin" title="spawned from ${escapeHtml(t.origin)}">↳ ${escapeHtml(t.origin)}</span>` : ""}
        ${t.epic ? `<span class="tag">${escapeHtml(t.epic)}</span>` : ""}
        ${t.repo ? `<span class="tag tag-repo">${escapeHtml(t.repo)}</span>` : ""}
        ${roleTag(t)}
        ${engineTag(t)}
      </div>
      ${running ? `<button class="card-stop" type="button" data-stop="${escapeHtml(t.id)}" title="Stop this session">■ Stop session</button>` : ""}
      ${paused ? `<button class="card-resume" type="button" data-resume="${escapeHtml(t.id)}" title="Resume from where the session left off">▶ Resume</button>` : ""}
    </div>`;
}

function renderBoard() {
  const board = $("#board");
  board.innerHTML = "";

  if (state.tickets.length === 0) {
    board.insertAdjacentHTML("beforeend", boardEmptyStateHtml());
  }

  for (const col of COLUMNS) {
    const items = state.tickets
      .filter((t) => (t.status || "backlog") === col.status)
      // Ready filter only narrows the Backlog column. isReady() is false for
      // every non-triage/backlog status, so applying it board-wide blanked out
      // In Progress / Blocked / Human Review / Done. Other columns stay intact.
      .filter((t) => !state.readyOnly || col.status !== "backlog" || isReady(t))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    const colEl = document.createElement("section");
    colEl.className = "column";
    colEl.innerHTML = `
      <div class="column-head">
        <span class="column-title">${col.title}</span>
        <span class="column-count">${items.length}</span>
      </div>
      <div class="column-body" data-status="${col.status}">
        ${
          items.length
            ? items.map(cardHtml).join("")
            : columnHint(col.status)
            ? `<p class="column-empty-hint">${escapeHtml(columnHint(col.status))}</p>`
            : ""
        }
      </div>`;
    board.appendChild(colEl);
  }

  wireBoardEmptyActions();
  wireDragAndDrop();
  wireCardClicks();
}

// ---------- drag and drop ----------
function wireDragAndDrop() {
  document.querySelectorAll(".column-body").forEach((body) => {
    Sortable.create(body, {
      group: "board",
      animation: 140,
      ghostClass: "sortable-ghost",
      dragClass: "sortable-drag",
      // Don't start a drag when the press lands on the in-card Stop or Resume button.
      filter: ".card-stop, .card-resume, .column-empty-hint",
      preventOnFilter: false,
      onAdd: async (evt) => {
        const id = evt.item.dataset.id;
        const newStatus = evt.to.dataset.status;
        const ticket = state.byId.get(id);
        const prevStatus = ticket ? ticket.status : null;
        if (!ticket || newStatus === prevStatus) return;

        // Optimistic local update.
        ticket.status = newStatus;
        try {
          const result = await patchTicket(id, { status: newStatus });
          if (newStatus === "in_progress" && launchToast(id, result)) {
            /* launchToast handled the message */
          } else {
            toast(`${id} → ${newStatus}`);
          }
        } catch (err) {
          toast(err.message);
          ticket.status = prevStatus;
        }
        await loadTickets();
        await loadBoardState();
        renderBoard();
        if (state.openTicketId === id) openPanel(id, { keepLog: true });
      },
    });
  });
}

function wireCardClicks() {
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", (e) => {
      const stopBtn = e.target.closest(".card-stop");
      if (stopBtn) {
        e.stopPropagation();
        stopSession(stopBtn.dataset.stop);
        return;
      }
      const resumeBtn = e.target.closest(".card-resume");
      if (resumeBtn) {
        e.stopPropagation();
        resumeSession(resumeBtn.dataset.resume);
        return;
      }
      openPanel(card.dataset.id);
    });
  });
}

// ---------- side panel ----------
function depChip(id) {
  const dep = state.byId.get(id);
  const done = dep && dep.status === "done";
  const cls = !dep ? "" : done ? "done" : "pending";
  return `<span class="chip ${cls}">${escapeHtml(id)}${
    dep ? "" : " ?"
  }</span>`;
}

function queuedExplanation(ticket) {
  const reason = ticket.queued_reason;
  if (reason === "disarmed") {
    return {
      title: "Queued — board disarmed",
      body: "This ticket has a launch request, but HelmMate will not start an agent until the board is armed. Arm the board to launch it when a WIP slot is free.",
    };
  }
  if (reason === "wip_limit") {
    return {
      title: "Queued — WIP limit reached",
      body: "This ticket has a launch request and will start automatically when a running session finishes and a WIP slot is free.",
    };
  }
  return {
    title: "Queued",
    body: "This ticket has a launch request but no agent session exists yet. Move it to Backlog to cancel, or to In Progress to retry launch now.",
  };
}

function codexModelOptions(t) {
  const roleDefault = CODEX_MODEL_BY_ROLE[resolveRole(t)] || "gpt-5.4-mini";
  const current = t && CODEX_MODELS.includes(t.codex_model) ? t.codex_model : "";
  return [
    `<option value=""${current ? "" : " selected"}>Role default (${escapeHtml(roleDefault)})</option>`,
    ...CODEX_MODELS.map(
      (m) => `<option value="${escapeHtml(m)}"${current === m ? " selected" : ""}>${escapeHtml(m)}</option>`
    ),
  ].join("");
}

function codexEffortOptions(t) {
  const roleDefault = CODEX_EFFORT_BY_ROLE[resolveRole(t)] || "medium";
  const current = t && CODEX_EFFORTS.includes(t.codex_effort) ? t.codex_effort : "";
  return [
    `<option value=""${current ? "" : " selected"}>Role default (${escapeHtml(roleDefault)})</option>`,
    ...CODEX_EFFORTS.map(
      (e) => `<option value="${escapeHtml(e)}"${current === e ? " selected" : ""}>${escapeHtml(e)}</option>`
    ),
  ].join("");
}

function openPanel(id, opts = {}) {
  const t = state.byId.get(id);
  if (!t) return;
  state.openTicketId = id;

  const ac = Array.isArray(t.acceptance_criteria) ? t.acceptance_criteria : [];
  const deps = Array.isArray(t.depends_on) ? t.depends_on : [];
  const refs = Array.isArray(t.context_refs) ? t.context_refs : [];
  const latestNote = Array.isArray(t.notes) && t.notes.length ? t.notes[t.notes.length - 1] : null;
  const queuedInfo = isQueued(t) ? queuedExplanation(t) : null;

  const prLink = t.pr_url
    ? `<a href="${escapeHtml(t.pr_url)}" target="_blank" rel="noopener">${escapeHtml(t.pr_url)}</a>`
    : "—";

  $("#panel-body").innerHTML = `
    <span class="panel-id">${escapeHtml(t.id)} &middot; ${escapeHtml(t.status)}${
      t.origin ? ` &middot; ↳ from ${escapeHtml(t.origin)}` : ""
    }</span>
    <h2>${escapeHtml(t.title)}</h2>
    <div class="card-meta" style="margin-top:8px">
      ${priorityPill(t.priority)}
      ${t.origin ? `<span class="tag tag-origin">↳ ${escapeHtml(t.origin)}</span>` : ""}
      ${t.epic ? `<span class="tag">${escapeHtml(t.epic)}</span>` : ""}
      ${t.repo ? `<span class="tag tag-repo">${escapeHtml(t.repo)}</span>` : ""}
      ${roleTag(t)}
      ${engineTag(t)}
      ${t.size ? `<span class="tag">size ${escapeHtml(t.size)}</span>` : ""}
    </div>

    <div class="panel-section">
      <h3>Move to</h3>
      <select class="panel-move" id="panel-move" aria-label="Move ticket to status">
        ${COLUMNS.map(
          (c) => `<option value="${c.status}"${c.status === t.status ? " selected" : ""}>${escapeHtml(c.title)}</option>`
        ).join("")}
      </select>
    </div>

    <div class="panel-section">
      <h3>Engine</h3>
      <select class="panel-move" id="panel-engine" aria-label="Engine for this ticket">
        <option value=""${!ENGINES.includes(t.engine) ? " selected" : ""}>Board default (${escapeHtml(boardDefaultEngine())})</option>
        ${ENGINES.map((engine) => `<option value="${escapeHtml(engine)}"${t.engine === engine ? " selected" : ""}>${escapeHtml(titleForStatus(engine))}</option>`).join("")}
      </select>
      <p class="panel-hint">Codex runs on your ChatGPT plan — use it when Claude usage is exhausted.</p>
    </div>

    <div class="panel-section">
      <h3>Codex routing</h3>
      <div class="kv"><span class="kv-key">resolved</span><span class="kv-val">${escapeHtml(codexModel(t))} · ${escapeHtml(codexEffort(t))}</span></div>
      <label class="panel-label" for="panel-codex-model">Model</label>
      <select class="panel-move" id="panel-codex-model" aria-label="Codex model for this ticket">
        ${codexModelOptions(t)}
      </select>
      <label class="panel-label" for="panel-codex-effort">Reasoning effort</label>
      <select class="panel-move" id="panel-codex-effort" aria-label="Codex reasoning effort for this ticket">
        ${codexEffortOptions(t)}
      </select>
      <p class="panel-hint">Used only when this ticket resolves to Codex. Empty means role default, not global config default.</p>
    </div>

    ${
      isSessionRunning(id)
        ? `<div class="panel-section">
             <h3>Session</h3>
             <button class="stop-btn" id="stop-session" type="button">■ Stop session</button>
             <p class="panel-hint">Kills the agent process working this ticket and reverts it to Backlog.</p>
           </div>`
        : isSessionPaused(t)
        ? `<div class="panel-section resume-section">
             <h3>Session paused — usage limit hit</h3>
             <p class="panel-hint">The worktree and branch are preserved. Resume to continue from exactly where the session left off.</p>
             <button class="resume-btn" id="resume-session" type="button">▶ Resume session</button>
           </div>`
        : ""
    }

    ${
      queuedInfo
        ? `<div class="panel-section queued-section">
             <h3>${escapeHtml(queuedInfo.title)}</h3>
             <p class="panel-hint">${escapeHtml(queuedInfo.body)}</p>
             ${t.queued_detail ? `<p class="panel-desc">${escapeHtml(t.queued_detail)}</p>` : ""}
           </div>`
        : ""
    }

    <div class="panel-section">
      <h3>Description</h3>
      <p class="panel-desc">${escapeHtml(t.description)}</p>
    </div>

    ${
      t.status === "blocked" && latestNote
        ? `<div class="panel-section">
             <h3>Latest blocker</h3>
             <p class="panel-desc">${escapeHtml(latestNote)}</p>
           </div>`
        : ""
    }

    ${
      ac.length
        ? `<div class="panel-section">
             <h3>Acceptance criteria</h3>
             <ul class="ac-list">
               ${ac.map((c) => `<li><span class="ac-box"></span><span>${escapeHtml(c)}</span></li>`).join("")}
             </ul>
           </div>`
        : ""
    }

    <div class="panel-section">
      <h3>Depends on</h3>
      ${deps.length ? `<div class="chip-row">${deps.map(depChip).join("")}</div>` : `<p class="panel-desc">None</p>`}
    </div>

    <div class="panel-section">
      <h3>Branch &amp; PR</h3>
      <div class="kv"><span class="kv-key">branch</span><span class="kv-val">${escapeHtml(t.branch) || "—"}</span></div>
      <div class="kv"><span class="kv-key">pr</span><span class="kv-val">${prLink}</span></div>
    </div>

    ${
      refs.length
        ? `<div class="panel-section">
             <h3>Context refs</h3>
             <ul class="ref-list">${refs.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
           </div>`
        : ""
    }

    <div class="panel-section">
      <h3>Live log</h3>
      <div class="log-view" id="log-view"><span class="log-empty">loading…</span></div>
    </div>
  `;

  $("#panel").hidden = false;
  $("#panel").setAttribute("aria-hidden", "false");
  $("#panel-overlay").hidden = false;

  wirePanelMove(id);
  wirePanelEngine(id);
  wirePanelCodexRouting(id);
  wireStopButton(id);
  wireResumeButton(id);
  startLogPolling(id);
}

// Per-ticket engine override. Empty value clears it (engine: null → resolves to
// the board default). Re-renders so the card's engine chip updates immediately.
function wirePanelEngine(id) {
  const sel = $("#panel-engine");
  if (!sel) return;
  sel.addEventListener("change", async () => {
    const value = sel.value;
    try {
      await patchTicket(id, { engine: value || null });
      toast(value ? `${id} engine → ${value}` : `${id} engine → board default`);
    } catch (err) {
      toast(err.message);
    }
    await loadTickets();
    renderBoard();
    if (state.openTicketId === id) openPanel(id, { keepLog: true });
  });
}

function wirePanelCodexRouting(id) {
  const modelSel = $("#panel-codex-model");
  const effortSel = $("#panel-codex-effort");

  async function save(field, value, label) {
    try {
      await patchTicket(id, { [field]: value || null });
      toast(value ? `${id} ${label} → ${value}` : `${id} ${label} → role default`);
    } catch (err) {
      toast(err.message);
    }
    await loadTickets();
    renderBoard();
    if (state.openTicketId === id) openPanel(id, { keepLog: true });
  }

  if (modelSel) {
    modelSel.addEventListener("change", () => save("codex_model", modelSel.value, "Codex model"));
  }
  if (effortSel) {
    effortSel.addEventListener("change", () => save("codex_effort", effortSel.value, "Codex effort"));
  }
}

function wireStopButton(id) {
  const btn = $("#stop-session");
  if (!btn) return;
  btn.addEventListener("click", () => stopSession(id));
}

function wireResumeButton(id) {
  const btn = $("#resume-session");
  if (!btn) return;
  btn.addEventListener("click", () => resumeSession(id));
}

// Touch-friendly status change. SortableJS drag-and-drop never fires on touch
// screens, so on a phone this dropdown is the ONLY way to move a ticket.
// Moving to in_progress fires the same launcher path as a drag (and the same
// ARM caution applies). Additive on desktop too.
function wirePanelMove(id) {
  const sel = $("#panel-move");
  if (!sel) return;
  sel.addEventListener("change", async () => {
    const ticket = state.byId.get(id);
    const prevStatus = ticket ? ticket.status : null;
    const newStatus = sel.value;
    if (!ticket || newStatus === prevStatus) return;

    ticket.status = newStatus; // optimistic
    try {
      const result = await patchTicket(id, { status: newStatus });
      if (newStatus === "in_progress" && launchToast(id, result)) {
        /* launchToast handled the message */
      } else {
        toast(`${id} → ${newStatus}`);
      }
    } catch (err) {
      toast(err.message);
      ticket.status = prevStatus;
      sel.value = prevStatus; // revert the dropdown
    }
    await loadTickets();
    await loadBoardState();
    renderBoard();
    if (state.openTicketId === id) openPanel(id, { keepLog: true });
  });
}

function closePanel() {
  $("#panel").hidden = true;
  $("#panel").setAttribute("aria-hidden", "true");
  $("#panel-overlay").hidden = true;
  state.openTicketId = null;
  stopLogPolling();
}

// ---------- log polling ----------
async function fetchLog(id) {
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/log`);
    const text = await res.text();
    const view = $("#log-view");
    if (!view || state.openTicketId !== id) return;
    const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 40;
    if (text.trim() === "") {
      view.innerHTML = '<span class="log-empty">No log output yet.</span>';
    } else {
      view.textContent = text;
      if (atBottom) view.scrollTop = view.scrollHeight;
    }
  } catch {
    /* transient */
  }
}

function startLogPolling(id) {
  stopLogPolling();
  fetchLog(id);
  state.logTimer = setInterval(() => fetchLog(id), 2000);
}

function stopLogPolling() {
  if (state.logTimer) clearInterval(state.logTimer);
  state.logTimer = null;
}

// ---------- wiring ----------
function wireChrome() {
  $("#arm-toggle").addEventListener("click", () => setArmed(!state.board.armed));
  const engineBtn = $("#engine-toggle");
  if (engineBtn) {
    engineBtn.addEventListener("click", () => {
      const current = boardDefaultEngine();
      const next = ENGINES[(ENGINES.indexOf(current) + 1) % ENGINES.length] || current;
      setBoardDefaultEngine(next);
    });
  }
  $("#ready-toggle").addEventListener("click", () => {
    state.readyOnly = !state.readyOnly;
    renderHeader();
    renderBoard();
  });
  $("#refresh").addEventListener("click", refresh);
  $("#panel-close").addEventListener("click", closePanel);
  $("#panel-overlay").addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });
}

async function refresh() {
  await Promise.all([loadConfig(), loadTickets(), loadBoardState()]);
  renderBoard();
  if (state.openTicketId) openPanel(state.openTicketId);
}

// Periodically refresh board state (running set / arm flag) so the header
// and the WIP count stay live even when launches happen out of band. When the
// running set changes (a session started/stopped out of band), re-render the
// board so the per-card Stop button + running badge appear/disappear live.
async function pollBoardState() {
  const prev = (state.board.running || []).join(",");
  await loadBoardState();
  const now = (state.board.running || []).join(",");
  if (now !== prev) renderBoard();
}

async function init() {
  wireChrome();
  await refresh();
  setInterval(pollBoardState, 4000);
}

init();
