// helmmate server — local kanban + auto-launch watcher.
// One dependency: express. Static front end in public/.
import express from "express";
import fs from "node:fs";
import {
  AGENTS_DIR,
  BOARD_DIR,
  CONFIG,
  HOST,
  MEMORY_QUEUE_DIR,
  PORT,
  PUBLIC_DIR,
  REPO_KEYS,
  REPOS,
  TICKETS_DIR,
  TICKETS_INDEX,
  LOGS_DIR,
  RUNS_FILE,
  SCRIPTS_PROMPT,
  FIX_CI_PROMPT,
  FIX_CONFLICT_PROMPT,
  WORK_PROMPT_REF,
  FIX_CI_PROMPT_REF,
  FIX_CONFLICT_PROMPT_REF,
  ROLE_BY_REPO,
  AGENT_MODEL,
} from "./lib/paths.js";
import {
  addRunning,
  loadState,
  publicState,
  setArmed,
  setAutopilot,
  setDefaultEngine,
  getBreaker,
  clearBreaker,
} from "./lib/state.js";
import { CODEX_COMMAND, ENGINES, OPENCODE_COMMAND } from "./lib/engine.js";
import {
  CODEX_EFFORT_BY_ROLE,
  CODEX_EFFORTS,
  CODEX_MODEL_BY_ROLE,
  CODEX_MODELS,
  OPENCODE_MODEL_BY_ROLE,
  OPENCODE_MODELS,
  OPENCODE_VARIANT_BY_ROLE,
  OPENCODE_VARIANTS,
} from "./lib/roles.js";
import { getRuns, reconcileRuns, usageByRoleAndModel } from "./lib/runs.js";
import { listConfiguredAgents, writeAgent, isValidRole } from "./lib/agents-config.js";
import { listQueue, resolveQueueItem } from "./lib/memory-queue.js";
import {
  readAllTickets,
  readTicket,
  writeTicket,
  rewriteIndex,
  isValidId,
  buildNewTicket,
} from "./lib/tickets.js";
import { deleteProject, listProjects, saveProject, setActiveProject } from "./lib/project-config.js";
import {
  buildSkillInstallCommand,
  doctorAgentCommands,
  firstTicketAgentCommands,
  importNotesAgentCommands,
  setupAgentCommands,
} from "./lib/setup-agent.js";
import { drainQueuedTickets, launchTicket, stopTicket } from "./lib/launcher.js";
import { buildLaunchPreview } from "./lib/launch-preview.js";
import { manualFix } from "./lib/ci-watch.js";
import { getUsage } from "./lib/usage.js";
import { refreshOfficialUsage } from "./lib/official-usage.js";
import { getCodexUsage } from "./lib/codex-usage.js";
import * as scheduler from "./lib/scheduler.js";
import {
  validateTicketSemantics,
  validateTicketShape,
} from "./lib/validation.js";

loadState();
for (const run of reconcileRuns()) {
  addRunning(run.ticket_id, run.pid);
}

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

function setupStatusSnapshot() {
  const ticketsDirExists = fs.existsSync(TICKETS_DIR);
  const indexExists = fs.existsSync(TICKETS_INDEX);
  const tickets = readAllTickets();
  const registry = listProjects();
  const requiresRestart = !!registry.requiresRestartToSwitch;
  const projectConfigured = !!registry.projectConfigured;
  const repoStatus = projectConfigured ? Object.entries(REPOS).map(([key, repo]) => ({
    key,
    path: repo.path,
    exists: fs.existsSync(repo.path),
    baseBranch: repo.baseBranch,
    worktree: !!repo.worktree,
    role: repo.role || null,
  })) : [];
  return {
    configPath: CONFIG.configPath,
    activeProject: CONFIG.activeProject,
    configuredActiveProject: registry.activeProject,
    runtimeActiveProject: registry.runtimeActiveProject,
    projectConfigured,
    requiresRestart,
    restartReason: requiresRestart
      ? "The active project in helmmate.config.json differs from the project loaded when the server started."
      : "",
    workspaceDir: CONFIG.workspaceDir,
    ticketsDir: TICKETS_DIR,
    ticketsDirExists,
    indexExists,
    ticketCount: tickets.length,
    repos: projectConfigured ? Object.keys(CONFIG.repos) : [],
    repoStatus,
    agentDir: AGENTS_DIR,
    agentDirExists: fs.existsSync(AGENTS_DIR),
    memoryQueueDir: MEMORY_QUEUE_DIR,
    memoryQueueDirExists: fs.existsSync(MEMORY_QUEUE_DIR),
    helmMateDir: BOARD_DIR,
    skillInstallCommand: buildSkillInstallCommand(BOARD_DIR),
    ready: projectConfigured && ticketsDirExists && indexExists && REPO_KEYS.length > 0,
  };
}

function existsStatus(file) {
  return {
    path: file,
    exists: fs.existsSync(file),
  };
}

function roleMeaning(role) {
  if (role === "cross-repo") {
    return "Generalist role used when a ticket spans repos, has no repo-specific role, or needs coordination across the workspace.";
  }
  if (role === "architect") {
    return "Planning and design-review role for higher-level architecture work; defaults to the strongest/most expensive model tier.";
  }
  return "Repo-specific implementation role used when a mapped repo owns the ticket.";
}

function agentsSetupSnapshot() {
  const agents = listConfiguredAgents(CONFIG.roles).map((agent) => {
    const configuredModel = agent.configuredModel || (CONFIG.roles[agent.role] && CONFIG.roles[agent.role].model) || "";
    const claudeModel = agent.model || configuredModel || AGENT_MODEL;
    const body = agent.body || "";
    return {
      ...agent,
      meaning: roleMeaning(agent.role),
      persona: {
        path: agent.path,
        exists: !!agent.exists,
        description: agent.description || "",
        model: agent.model || "",
        preview: body.trim().slice(0, 1200),
        previewTruncated: body.trim().length > 1200,
      },
      claude: {
        model: claudeModel,
        source: agent.model ? "persona frontmatter" : configuredModel ? "role config fallback" : "global agentModel fallback",
      },
      codex: {
        model: CODEX_MODEL_BY_ROLE[agent.role] || "gpt-5.4-mini",
        effort: CODEX_EFFORT_BY_ROLE[agent.role] || "medium",
        source: "role default",
      },
      opencode: {
        model: OPENCODE_MODEL_BY_ROLE[agent.role] || "opencode-go/minimax-m2.7",
        variant: OPENCODE_VARIANT_BY_ROLE[agent.role] || "",
        source: "role default",
      },
    };
  });
  const roles = new Set(agents.map((agent) => agent.role));
  for (const role of Object.values(ROLE_BY_REPO || {})) {
    if (role) roles.add(role);
  }
  if (!roles.has("cross-repo")) roles.add("cross-repo");

  const repoMappings = Object.entries(CONFIG.repos).map(([key, repo]) => ({
    key,
    path: repo.path,
    exists: fs.existsSync(repo.path),
    role: ROLE_BY_REPO[key] || repo.role || "cross-repo",
    source: repo.role ? "repo config" : ROLE_BY_REPO[key] ? "roleByRepo" : "fallback",
    baseBranch: repo.baseBranch,
    worktree: !!repo.worktree,
  }));

  return {
    readOnly: true,
    engine: {
      default: publicState().defaultEngine,
      configuredDefault: CONFIG.engines.default,
      allowed: CONFIG.engines.allowed,
      explanation:
        "A ticket-level engine override wins. Otherwise HelmMate uses the board-wide default engine shown here; the configured default is only the startup fallback.",
      commands: {
        claude: "claude",
        codex: CODEX_COMMAND,
        opencode: OPENCODE_COMMAND,
      },
    },
    roles: agents,
    roleRouting: {
      explanation:
        "A ticket.role override wins. Otherwise HelmMate maps the ticket repo to a role; unmapped tickets fall back to cross-repo.",
      repoMappings,
    },
    prompts: [
      { key: "work", label: "Work prompt", ref: WORK_PROMPT_REF, ...existsStatus(SCRIPTS_PROMPT) },
      { key: "ci", label: "CI fix prompt", ref: FIX_CI_PROMPT_REF, ...existsStatus(FIX_CI_PROMPT) },
      { key: "conflict", label: "Conflict fix prompt", ref: FIX_CONFLICT_PROMPT_REF, ...existsStatus(FIX_CONFLICT_PROMPT) },
    ],
    permissions: {
      level: "warning",
      text:
        "Launches run with bypassed CLI permission/sandbox flags. Review the engine, role, prompt file, repo mapping, and worktree mode before arming or launching.",
      claude: "--dangerously-skip-permissions",
      codex: "--dangerously-bypass-approvals-and-sandbox",
      opencode: "--dangerously-skip-permissions",
    },
    locations: {
      logsDir: LOGS_DIR,
      ticketLogPattern: `${LOGS_DIR}/<ticket-id>.log`,
      runsLedger: RUNS_FILE,
      memoryQueueDir: MEMORY_QUEUE_DIR,
      memoryProposalPattern: `${MEMORY_QUEUE_DIR}/<proposal>.md`,
    },
  };
}

// GET /api/config -> public, non-secret runtime config for the UI.
app.get("/api/config", (_req, res) => {
  res.json({
    ticketIdPrefix: CONFIG.ticketIdPrefix,
    activeProject: CONFIG.activeProject,
    repos: Object.keys(CONFIG.repos),
    statuses: CONFIG.statuses,
    engines: CONFIG.engines.allowed,
    defaultEngine: CONFIG.engines.default,
    roles: CONFIG.roles,
    roleByRepo: CONFIG.roleByRepo,
    workspaceDir: CONFIG.workspaceDir,
    ticketsDir: CONFIG.ticketsDir,
  });
});

// GET /api/setup/status -> first-run checklist for onboarding.
app.get("/api/setup/status", (_req, res) => {
  res.json(setupStatusSnapshot());
});

// POST /api/setup/init -> create local scaffold dirs/files for the active project.
app.post("/api/setup/init", (_req, res) => {
  try {
    fs.mkdirSync(TICKETS_DIR, { recursive: true });
    if (!fs.existsSync(TICKETS_INDEX)) fs.writeFileSync(TICKETS_INDEX, "[]\n");
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
    fs.mkdirSync(MEMORY_QUEUE_DIR, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/setup/agent-prompt -> generate a setup prompt/command for a local
// coding agent. This is intentionally prompt-only for now; the UI can copy it
// into Claude Code, Codex, or opencode without spawning a privileged process.
app.post("/api/setup/agent-prompt", (req, res) => {
  res.json(setupAgentCommands(req.body || {}));
});

// POST /api/setup/doctor-prompt -> generate a read-only Doctor prompt/command
// for a coding agent. Mirrors setup handoff: the browser only copies text.
app.post("/api/setup/doctor-prompt", (_req, res) => {
  res.json(doctorAgentCommands({ setup: setupStatusSnapshot(), state: publicState() }));
});

// POST /api/setup/first-ticket-prompt -> generate a prompt that asks a local
// coding agent to create the first reviewed triage ticket via helm-create-ticket.
app.post("/api/setup/first-ticket-prompt", (_req, res) => {
  res.json(
    firstTicketAgentCommands({
      activeProject: CONFIG.activeProject,
      workspaceDir: CONFIG.workspaceDir,
      ticketsDir: CONFIG.ticketsDir,
      ticketIdPrefix: CONFIG.ticketIdPrefix,
      repos: REPO_KEYS,
      statuses: CONFIG.statuses,
      defaultRepo: REPO_KEYS[0] || "workspace",
      helmMateDir: BOARD_DIR,
    })
  );
});

// POST /api/import/notes-prompt -> generate a prompt that hands pasted notes to
// helm-create-ticket. The browser only copies text; the user's coding agent
// does the actual ticket creation and validation.
app.post("/api/import/notes-prompt", (req, res) => {
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const notes = typeof b.notes === "string" ? b.notes.trim() : "";
  if (!notes) return res.status(400).json({ error: "notes are required" });
  const rawRefs = Array.isArray(b.contextRefs)
    ? b.contextRefs
    : typeof b.contextRefs === "string"
    ? b.contextRefs.split(/\r?\n/)
    : [];
  const contextRefs = rawRefs.map((item) => String(item || "").trim()).filter(Boolean);
  res.json(
    importNotesAgentCommands({
      notes,
      contextRefs,
      createImmediately: b.createImmediately !== false,
      activeProject: CONFIG.activeProject,
      workspaceDir: CONFIG.workspaceDir,
      ticketsDir: CONFIG.ticketsDir,
      ticketIdPrefix: CONFIG.ticketIdPrefix,
      repos: REPO_KEYS,
      statuses: CONFIG.statuses,
      defaultRepo: REPO_KEYS[0] || "workspace",
    })
  );
});

// GET /api/projects -> project registry from helmmate.config.json.
app.get("/api/projects", (_req, res) => {
  res.json(listProjects());
});

// PUT /api/projects/:id -> create/update one project config.
app.put("/api/projects/:id", (req, res) => {
  const result = saveProject(req.params.id, req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// POST /api/projects/active -> set active project in config. Paths are resolved
// at server startup, so a switch is persisted but takes effect after restart.
app.post("/api/projects/active", (req, res) => {
  const result = setActiveProject(req.body && req.body.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.delete("/api/projects/:id", (req, res) => {
  const result = deleteProject(req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// GET /api/tickets -> all tickets, sorted by id.
app.get("/api/tickets", (_req, res) => {
  res.json(readAllTickets());
});

function ticketFieldFromIssue(item) {
  const code = item && item.code;
  const message = item && item.message ? item.message : "";
  const direct = {
    bad_status: "status",
    bad_repo: "repo",
    bad_priority: "priority",
    bad_acceptance_criteria: "acceptance_criteria",
    bad_context_refs: "context_refs",
    bad_notes: "notes",
    bad_depends_on: "depends_on",
    bad_size: "size",
    bad_source: "source",
    bad_codex_model: "codex_model",
    bad_codex_effort: "codex_effort",
    bad_opencode_model: "opencode_model",
    bad_opencode_variant: "opencode_variant",
    missing_dependency: "depends_on",
  };
  if (direct[code]) return direct[code];
  const missing = message.match(/^missing ([A-Za-z0-9_]+)$/);
  return missing ? missing[1] : "form";
}

function validationResponse(ticket, allTickets = readAllTickets()) {
  const allById = new Map(allTickets.map((item) => [item.id, item]));
  if (ticket && ticket.id) allById.set(ticket.id, ticket);
  const issues = [
    ...validateTicketShape(ticket),
    ...validateTicketSemantics(ticket, allById),
  ];
  const errors = issues.filter((item) => item.level === "error");
  const fieldErrors = {};
  for (const item of errors) {
    const field = ticketFieldFromIssue(item);
    if (!fieldErrors[field]) fieldErrors[field] = item.message;
  }
  return { issues, errors, fieldErrors };
}

// POST /api/tickets -> create a ticket from onboarding / UI.
app.post("/api/tickets", (req, res) => {
  const b = req.body && typeof req.body === "object" ? req.body : {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: "title is required" });
  if (b.repo && !REPO_KEYS.includes(b.repo)) {
    return res.status(400).json({ error: "invalid repo", allowed: REPO_KEYS });
  }
  const ticket = buildNewTicket({
    title: b.title,
    repo: b.repo,
    priority: b.priority,
    status: b.status,
    description: b.description,
    acceptance_criteria: Array.isArray(b.acceptance_criteria) ? b.acceptance_criteria : [],
    context_refs: Array.isArray(b.context_refs) ? b.context_refs : [],
  });
  if (readTicket(ticket.id)) return res.status(409).json({ error: "ticket id already exists", id: ticket.id });
  if (Array.isArray(b.notes)) ticket.notes = b.notes;
  const validation = validationResponse(ticket);
  if (validation.errors.length) {
    return res.status(400).json({
      error: "validation failed",
      issues: validation.issues,
      fieldErrors: validation.fieldErrors,
    });
  }
  try {
    writeTicket(ticket);
    rewriteIndex();
    res.status(201).json({ ticket });
  } catch (err) {
    res.status(500).json({ error: "write failed", detail: err.message });
  }
});

// PATCH /api/tickets/:id -> merge body, bump updated, rewrite index,
// and fire the launcher when status flips to in_progress.
app.patch("/api/tickets/:id", (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: "invalid id" });

  const ticket = readTicket(id);
  if (!ticket) return res.status(404).json({ error: "ticket not found" });

  const patch = req.body && typeof req.body === "object" ? req.body : {};
  const prevStatus = ticket.status;

  // Never let the body overwrite the id.
  delete patch.id;

  // Reject an unknown engine so a typo can't silently route a ticket nowhere
  // (resolveEngine would fall back to the default, masking the mistake).
  if (patch.engine != null && !ENGINES.includes(patch.engine)) {
    return res.status(400).json({ error: "invalid engine", allowed: ENGINES });
  }
  if (patch.codex_model != null && patch.codex_model !== "" && !CODEX_MODELS.includes(patch.codex_model)) {
    return res.status(400).json({ error: "invalid codex_model", allowed: CODEX_MODELS });
  }
  if (patch.codex_effort != null && patch.codex_effort !== "" && !CODEX_EFFORTS.includes(patch.codex_effort)) {
    return res.status(400).json({ error: "invalid codex_effort", allowed: CODEX_EFFORTS });
  }
  if (patch.opencode_model != null && patch.opencode_model !== "" && !OPENCODE_MODELS.includes(patch.opencode_model)) {
    return res.status(400).json({ error: "invalid opencode_model", allowed: OPENCODE_MODELS });
  }
  if (
    patch.opencode_variant != null &&
    patch.opencode_variant !== "" &&
    !OPENCODE_VARIANTS.includes(patch.opencode_variant)
  ) {
    return res.status(400).json({ error: "invalid opencode_variant", allowed: OPENCODE_VARIANTS });
  }

  const wantsLaunch = patch.status === "in_progress" && prevStatus !== "in_progress";
  const merged = { ...ticket, ...patch };
  if (wantsLaunch) merged.status = prevStatus;
  if (patch.status && patch.status !== "queued") {
    delete merged.queued_reason;
    delete merged.queued_detail;
    delete merged.queued_at;
  }
  merged.updated = new Date().toISOString().slice(0, 10);

  const allTickets = readAllTickets().map((item) => (item.id === id ? merged : item));
  const validation = validationResponse(merged, allTickets);
  if (validation.errors.length) {
    return res.status(400).json({
      error: "validation failed",
      issues: validation.issues,
      fieldErrors: validation.fieldErrors,
    });
  }

  try {
    writeTicket(merged);
  } catch (err) {
    return res.status(500).json({ error: "write failed", detail: err.message });
  }
  rewriteIndex();

  let launch = null;
  if (wantsLaunch) {
    launch = launchTicket({ ...merged, status: "in_progress" }, { previousStatus: prevStatus });
  }

  res.json({ ticket: readTicket(id) || merged, launch });
});

// GET /api/tickets/:id/launch-preview -> read-only explanation of the launch
// choices and blockers. This must not dispatch or prepare a worktree.
app.get("/api/tickets/:id/launch-preview", (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: "invalid id" });

  const ticket = readTicket(id);
  if (!ticket) return res.status(404).json({ error: "ticket not found" });

  res.json(buildLaunchPreview(ticket));
});

// GET /api/tickets/:id/log -> tail the ticket log (plain text).
app.get("/api/tickets/:id/log", (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).type("text/plain").send("invalid id");
  res.type("text/plain");
  const file = `${LOGS_DIR}/${id}.log`;
  try {
    if (!fs.existsSync(file)) return res.send("");
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split("\n");
    const tail = lines.slice(-400).join("\n"); // last ~400 lines
    res.send(tail);
  } catch (err) {
    res.send(`[log read error] ${err.message}`);
  }
});

// POST /api/tickets/:id/fix -> manually dispatch a fix session for the ticket's
// open PR. Body { kind?: "ci-fix" | "conflict-fix" } (omit to auto-detect).
// Bypasses autopilot/cap/night gates (human-initiated); refuses on a tripped
// breaker or an already-running session.
app.post("/api/tickets/:id/fix", (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: "invalid id" });
  const body = req.body || {};
  const result = manualFix(id, { kind: body.kind, pr: body.pr });
  if (!result.launched) {
    return res.status(409).json({ error: "fix not dispatched", reason: result.reason });
  }
  res.json(result);
});

// POST /api/tickets/:id/resume -> re-launch a session that was paused due to a
// usage limit. Reuses the existing worktree and branch so work continues from
// where it left off. Human-initiated — bypasses the circuit breaker and autopilot
// gates, but still requires armed + WIP slot. The ticket must have last_run_limit_hit
// set (written by the launcher when a session exits with limit_hit: true).
app.post("/api/tickets/:id/resume", (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: "invalid id" });

  const ticket = readTicket(id);
  if (!ticket) return res.status(404).json({ error: "ticket not found" });

  if (!ticket.last_run_limit_hit) {
    return res.status(409).json({ error: "no paused-on-limit state to resume", id });
  }

  if (ticket.status !== "in_progress" && ticket.status !== "backlog" && ticket.status !== "queued") {
    return res.status(409).json({
      error: "paused state is stale for this ticket status",
      id,
      status: ticket.status,
    });
  }

  const result = launchTicket(ticket, { previousStatus: "in_progress", reuseWorktree: true, resume: true });
  if (!result.launched) {
    return res.status(409).json({ error: "resume not dispatched", reason: result.reason });
  }
  res.json(result);
});

// POST /api/tickets/:id/stop -> kill the running session working this ticket.
// SIGTERMs the session's process group (escalates to SIGKILL), marks the run
// "killed", and reverts a still-in_progress ticket to backlog. 409 if nothing
// live is running for the ticket.
app.post("/api/tickets/:id/stop", (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: "invalid id" });
  const result = stopTicket(id);
  if (!result.stopped) {
    return res.status(409).json({ error: "not stopped", reason: result.reason });
  }
  res.json(result);
});

// GET /api/state -> { armed, wipLimit, running }
app.get("/api/state", (_req, res) => {
  res.json(publicState());
});

// GET /api/runs -> persisted detached run ledger (newest first), with per-run
// token accounting. The Home tab reads `costUSD`; runs.js stores `cost_usd`, so
// alias it here without mutating the ledger shape on disk.
app.get("/api/runs", (_req, res) => {
  const runs = getRuns().map((r) => ({
    ...r,
    costUSD: typeof r.cost_usd === "number" ? r.cost_usd : null,
  }));
  res.json(runs);
});

// GET /api/agents -> configured role persona files + spend
// aggregated by role and by model from the run ledger. Powers the Agents tab.
app.get("/api/agents", (_req, res) => {
  res.json({
    setup: agentsSetupSnapshot(),
    agents: listConfiguredAgents(CONFIG.roles),
    usage: usageByRoleAndModel(),
    codex: {
      modelByRole: CODEX_MODEL_BY_ROLE,
      effortByRole: CODEX_EFFORT_BY_ROLE,
      models: CODEX_MODELS,
      efforts: CODEX_EFFORTS,
    },
    opencode: {
      modelByRole: OPENCODE_MODEL_BY_ROLE,
      variantByRole: OPENCODE_VARIANT_BY_ROLE,
      models: OPENCODE_MODELS,
      variants: OPENCODE_VARIANTS,
    },
  });
});

// PUT /api/agents/:role -> save edits to a persona file (description/model/body).
// Refuses an invalid role or model; the model written here becomes the source of
// truth read by lib/roles.js (so it flows to the launcher + the Opus gate).
app.put("/api/agents/:role", (req, res) => {
  const { role } = req.params;
  if (!isValidRole(role)) return res.status(400).json({ error: "invalid role" });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const result = writeAgent(role, {
    name: b.name,
    description: b.description,
    model: b.model,
    body: b.body,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ agent: result.agent });
});

// GET /api/memory-queue -> pending memory-update proposals dropped by autonomous
// sessions (memory/sync-queue/*.md). Surfaced in the Agents tab so they don't rot.
app.get("/api/memory-queue", (_req, res) => {
  res.json({ pending: listQueue() });
});

// POST /api/memory-queue/:id/resolve -> body { action: "archive" | "dismiss" }.
// archive = you applied it by hand (moves to sync-queue/applied/); dismiss =
// you skipped it (deletes). We never auto-apply to curated memory.
app.post("/api/memory-queue/:id/resolve", (req, res) => {
  const { id } = req.params;
  const action = req.body && req.body.action;
  const result = resolveQueueItem(id, action);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

// GET /api/usage -> usage probe mapped to the Home-tab contract. usage.js
// reports pct as a 0..1 fraction; the front end's gauge/percent formatter wants
// 0..100, so scale here. Tolerant of an error/empty probe result.
app.get("/api/usage", async (_req, res) => {
  // Best-effort: pull the authoritative %/reset from Anthropic's endpoint before
  // reading the probe, so the Home tab shows live (not estimated) numbers.
  try {
    await refreshOfficialUsage();
  } catch {
    /* fall back to the transcript estimate inside getUsage() */
  }
  const u = getUsage({ force: true });
  const b = u && u.block ? u.block : null;
  const w = u && u.weekly ? u.weekly : null;
  const pct100 = (p) => (typeof p === "number" ? Math.round(p * 1000) / 10 : null);
  const eu = b && b.official ? b.official.extraUsage : null;
  const codexUsage = getCodexUsage();

  res.json({
    metric: u && u.config ? u.config.token_metric : b ? b.metric : null,
    asOf: u ? u.generatedAt : new Date().toISOString(),
    source: b && b.pctSource ? b.pctSource : "estimate", // "official" | "estimate"
    officialError: b ? b.officialError || null : null,
    block: b
      ? {
          tokens_total: b.tokens ? b.tokens.total : null,
          tokens_metric: b.metricTokens,
          budget: b.effectiveBudget != null ? b.effectiveBudget : b.budget,
          pct: pct100(b.pct),
          source: b.pctSource || "estimate",
          startTime: b.startTime,
          resetTime: b.resetTime,
          minutesRemaining: b.minutesRemaining,
          burnTokensPerMin: b.burnTokensPerMin,
          projectedTokensAtReset: b.projectedTokensAtReset,
        }
      : null,
    weekly: w
      ? {
          tokens_metric: w.metricTokens,
          budget: w.budget,
          pct: pct100(w.pct),
          source: w.pctSource || "estimate",
          resetTime: w.resetTime || null,
        }
      : null,
    extra_usage: eu
      ? {
          enabled: !!eu.isEnabled,
          used_credits: eu.usedCredits,
          monthly_limit: eu.monthlyLimit,
          currency: eu.currency,
        }
      : null,
    codex: codexUsage,
  });
});

// GET /api/scheduler -> live scheduler/autopilot status (see HTTP CONTRACT).
app.get("/api/scheduler", (_req, res) => {
  res.json(scheduler.getSchedulerStatus());
});

// POST /api/autopilot -> body { on: bool }. Flips the persisted autopilot flag
// and returns the refreshed scheduler status.
app.post("/api/autopilot", (req, res) => {
  const on = !!(req.body && req.body.on);
  // Refuse to enable autopilot while the circuit breaker is tripped. A human
  // must consciously clear the breaker after acknowledging the usage-limit hit.
  if (on && getBreaker().tripped) {
    return res
      .status(409)
      .json({ error: "circuit breaker tripped — reset it first", ...scheduler.getSchedulerStatus() });
  }
  setAutopilot(on);
  res.json(scheduler.getSchedulerStatus());
});

// POST /api/breaker/reset -> manually clear a tripped circuit breaker.
app.post("/api/breaker/reset", (_req, res) => {
  clearBreaker();
  res.json(scheduler.getSchedulerStatus());
});

// POST /api/engine -> body { engine: "claude" | "codex" | "opencode" }. Sets
// the board-wide default engine for tickets that don't pin their own. Flip to
// "codex" or "opencode" when Claude usage is exhausted. Returns public state.
app.post("/api/engine", (req, res) => {
  const engine = req.body && req.body.engine;
  if (!ENGINES.includes(engine)) {
    return res.status(400).json({ error: "invalid engine", allowed: ENGINES });
  }
  setDefaultEngine(engine);
  res.json(publicState());
});

// POST /api/arm -> body { armed: bool }
app.post("/api/arm", (req, res) => {
  const armed = !!(req.body && req.body.armed);
  setArmed(armed);
  if (armed) drainQueuedTickets();
  res.json(publicState());
});

const server = app.listen(PORT, HOST, () => {
  console.log(`helmmate running at http://${HOST}:${PORT}`);
  console.log(`board state: ${JSON.stringify(publicState())}`);
  // Install the usage-aware continuous scheduler. Inert unless armed AND
  // autopilot are both on (autopilot defaults false), so this is safe to start
  // unconditionally.
  scheduler.start(server);
});
