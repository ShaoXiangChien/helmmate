// launchTicket(ticket): spawn an autonomous Claude Code session to work a
// ticket end to end. Heavily guarded — this is the "auto-launch" trigger
// and the only place that fires a real subprocess.
import fs from "node:fs";
import { spawn } from "node:child_process";
import {
  LOGS_DIR,
  WORKSPACE_DIR,
  AGENT_MODEL,
  CODEX_BIN,
  OPENCODE_BIN,
  TICKETS_REF,
  WORK_PROMPT_REF,
} from "./paths.js";
import { launchPreflight } from "./validation.js";
import { createRun, finishRun, getRuns } from "./runs.js";
import {
  isArmed,
  getWipLimit,
  runningIds,
  isRunning,
  addRunning,
  removeRunning,
  getRunningPid,
} from "./state.js";
import { readAllTickets, readTicket, writeTicket, rewriteIndex } from "./tickets.js";
import { ensureWorktree } from "./worktrees.js";
import {
  resolveRole,
  agentFileExists,
  effectiveModel,
  codexEffort,
  codexModel,
  opencodeModel,
  opencodeVariant,
} from "./roles.js";
import {
  resolveEngine,
  buildClaudeArgs,
  buildCodexArgs,
  buildOpenCodeArgs,
  codexInstruction,
  openCodeInstruction,
} from "./engine.js";

// Branch name convention: ticket/<id>-<short-kebab-slug-of-title>
export function branchForTicket(ticket) {
  const slug = String(ticket.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-");
  return slug ? `ticket/${ticket.id}-${slug}` : `ticket/${ticket.id}`;
}

function ensureLogsDir() {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  } catch {
    /* best effort */
  }
}

function logLine(id, line) {
  ensureLogsDir();
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  try {
    fs.appendFileSync(`${LOGS_DIR}/${id}.log`, stamped);
  } catch (err) {
    console.error(`[launcher] cannot write log for ${id}:`, err.message);
  }
}

function clearQueueFields(ticket) {
  delete ticket.queued_reason;
  delete ticket.queued_detail;
  delete ticket.queued_at;
}

function queueTicket(id, reason, note) {
  const t = readTicket(id);
  if (!t) return;
  const ts = new Date().toISOString();
  if (!Array.isArray(t.notes)) t.notes = [];
  t.notes.push(`${ts} — ${note}`);
  t.status = "queued";
  t.queued_reason = reason;
  t.queued_detail = note;
  t.queued_at = ts;
  t.updated = ts.slice(0, 10);
  writeTicket(t);
  rewriteIndex();
}

// Append a note to the ticket and persist it (also refreshes the index).
function addNote(id, note) {
  const t = readTicket(id);
  if (!t) return;
  if (!Array.isArray(t.notes)) t.notes = [];
  t.notes.push(`${new Date().toISOString()} — ${note}`);
  t.updated = new Date().toISOString().slice(0, 10);
  writeTicket(t);
  rewriteIndex();
}

function blockTicket(id, note) {
  const t = readTicket(id);
  if (!t) return;
  if (!Array.isArray(t.notes)) t.notes = [];
  t.notes.push(`${new Date().toISOString()} — ${note}`);
  t.status = "blocked";
  clearQueueFields(t);
  t.updated = new Date().toISOString().slice(0, 10);
  writeTicket(t);
  rewriteIndex();
}

function revertInProgress(id, note) {
  const t = readTicket(id);
  if (!t || t.status !== "in_progress") return false;
  if (!Array.isArray(t.notes)) t.notes = [];
  t.notes.push(`${new Date().toISOString()} — ${note}`);
  t.status = "backlog";
  clearQueueFields(t);
  t.updated = new Date().toISOString().slice(0, 10);
  writeTicket(t);
  rewriteIndex();
  return true;
}

function depsUnmet(ticket) {
  const deps = Array.isArray(ticket.depends_on) ? ticket.depends_on : [];
  return deps.filter((depId) => {
    const dep = readTicket(depId);
    return !dep || dep.status !== "done";
  });
}

export function launchTicket(ticket, options = {}) {
  const id = ticket.id;

  // GUARD: already running — don't double-spawn.
  if (isRunning(id)) {
    logLine(id, "already running; skipping launch");
    return { launched: false, reason: "already_running" };
  }

  // GUARD: dependencies must all be done.
  const unmet = depsUnmet(ticket);
  if (unmet.length > 0) {
    const msg = `blocked: unmet dependencies [${unmet.join(", ")}]`;
    logLine(id, msg);
    blockTicket(id, msg);
    return { launched: false, reason: "blocked", unmet };
  }

  // GUARD: preflight must not have hard failures.
  const preflight = launchPreflight(ticket, {
    statusForRules: options.previousStatus || ticket.status,
  });
  const errors = preflight.filter((item) => item.level === "error");
  const warnings = preflight.filter((item) => item.level === "warning");
  for (const warning of warnings) logLine(id, `preflight warning: ${warning.message}`);
  if (errors.length > 0) {
    const msg = `preflight failed: ${errors.map((item) => item.message).join("; ")}`;
    logLine(id, msg);
    blockTicket(id, msg);
    return { launched: false, reason: "preflight_failed", errors, warnings };
  }

  // GUARD: board must be armed. This is checked after ticket-level blockers so
  // queued stays reserved for launch gates that can clear without ticket edits.
  if (!isArmed()) {
    const msg = "queued (board disarmed)";
    logLine(id, msg);
    queueTicket(id, "disarmed", `${msg} — arm the board to launch when a WIP slot is free`);
    return { launched: false, reason: "disarmed" };
  }

  // GUARD: WIP limit.
  const wip = getWipLimit();
  if (runningIds().length >= wip) {
    const msg = `queued (WIP limit ${wip} reached: [${runningIds().join(", ")}])`;
    logLine(id, msg);
    queueTicket(id, "wip_limit", `${msg} — waits for a running session to finish`);
    return { launched: false, reason: "wip_limit" };
  }

  // All guards passed. Set up isolated git state BEFORE spawning so two
  // concurrent sessions in the same repo can't collide in the shared checkout.
  const branch = branchForTicket(ticket);
  const wt = ensureWorktree({
    repo: ticket.repo,
    ticketId: id,
    branch,
    baseBranch: "main",
    reuse: !!options.reuseWorktree,
  });

  if (wt.error) {
    const msg = `worktree setup failed: ${wt.error}`;
    logLine(id, msg);
    blockTicket(id, msg);
    return { launched: false, reason: "worktree_failed", error: wt.error, detail: wt };
  }

  // Tell the session exactly where its isolated checkout + branch live. For
  // worktree repos the branch ALREADY exists at this path (do not re-branch);
  // for workspace tickets it branches in place at the workspace root.
  let worktreeNote;
  if (wt.mode === "worktree") {
    worktreeNote =
      ` WORKTREE: your isolated ${ticket.repo} checkout and branch "${branch}" already ` +
      `exist at ${wt.path}. cd into that path for all ${ticket.repo} code and git work; ` +
      `do NOT create another branch. ${TICKETS_REF}/${id}.json updates still happen in the ` +
      `workspace at ${WORKSPACE_DIR}/${TICKETS_REF}.`;
  } else {
    worktreeNote =
      ` WORKTREE: this repo is configured to run in place. Branch "${branch}" in ` +
      `place at the workspace root (${WORKSPACE_DIR}) and do code + git work there.`;
  }

  const resumePrefix = options.resume
    ? "NOTE: This is a RESUME session — the previous run was interrupted by a usage limit. " +
      "The worktree and branch are preserved at their last state. Start by reviewing any " +
      "uncommitted changes, recent commits, and open PRs on this branch, then continue " +
      "working the ticket from exactly where it left off. Do NOT restart from scratch. "
    : "";

  const engine = resolveEngine(ticket);
  const role = resolveRole(ticket);
  const explicitModel = typeof ticket.model === "string" && ticket.model ? ticket.model : null;

  const instruction =
    resumePrefix +
    `ENGINE: ${engine}. ` +
    `You are an autonomous ticket-working session. Read ${WORK_PROMPT_REF} ` +
    `and follow it EXACTLY for ticket ${id} at ${TICKETS_REF}/${id}.json (repo: ${ticket.repo}). ` +
    "Work the ticket end to end, open a PR, then set the ticket status to human_review." +
    worktreeNote;

  // Resolve the role persona + model for this ticket (single source of truth:
  // roles.js). When a persona file exists we pass `--agent <role>` and let its
  // frontmatter pin the model; an explicit `ticket.model` is the ONLY thing that
  // overrides the frontmatter (e.g. an Opus opt-up on an otherwise-Sonnet role).
  // No persona on disk → fall back to a plain Sonnet run so a missing/renamed
  // role never hard-fails a session.
  // Resolve the engine (claude|codex|opencode) + role, then build the
  // subprocess through the engine.js seam. Codex/OpenCode get the persona body
  // prepended to the prompt; Claude passes --agent <role> and lets the persona
  // frontmatter pin the model.
  let command;
  let cliArgs;
  let launchDesc;
  let launchedModel;
  let runRole;
  if (engine === "codex") {
    const effort = codexEffort(ticket);
    const cmodel = codexModel(ticket);
    const pinnedModel = typeof ticket.codex_model === "string" && ticket.codex_model;
    const pinnedEffort = typeof ticket.codex_effort === "string" && ticket.codex_effort;
    command = CODEX_BIN;
    cliArgs = buildCodexArgs({
      instruction: codexInstruction(role, instruction),
      model: cmodel,
      effort,
      cwd: WORKSPACE_DIR,
    });
    launchedModel = cmodel;
    runRole = role;
    launchDesc =
      `codex exec (role:${role}, model:${cmodel}${pinnedModel ? " pinned" : " role-default"}, ` +
      `effort:${effort}${pinnedEffort ? " pinned" : " role-default"})`;
  } else if (engine === "opencode") {
    const omodel = opencodeModel(ticket);
    const variant = opencodeVariant(ticket);
    const pinnedModel = typeof ticket.opencode_model === "string" && ticket.opencode_model;
    const pinnedVariant = typeof ticket.opencode_variant === "string" && ticket.opencode_variant;
    command = OPENCODE_BIN;
    cliArgs = buildOpenCodeArgs({
      instruction: openCodeInstruction(role, instruction),
      model: omodel,
      variant,
      cwd: WORKSPACE_DIR,
    });
    launchedModel = omodel;
    runRole = role;
    launchDesc =
      `opencode run (role:${role}, model:${omodel}${pinnedModel ? " pinned" : " role-default"}` +
      `${variant ? `, variant:${variant}${pinnedVariant ? " pinned" : " role-default"}` : ""})`;
  } else {
    const useAgent = agentFileExists(role);
    command = "claude";
    cliArgs = buildClaudeArgs({ useAgent, role, explicitModel, agentModel: AGENT_MODEL, instruction });
    launchedModel = effectiveModel(ticket);
    runRole = useAgent ? role : null;
    launchDesc = useAgent
      ? `agent:${role}${explicitModel ? `, model:${explicitModel}` : " (frontmatter model)"}`
      : `model:${explicitModel || AGENT_MODEL} (no persona file for ${role})`;
  }

  ensureLogsDir();
  const logPath = `${LOGS_DIR}/${id}.log`;
  logLine(id, `launching (${engine}, ${launchDesc}) via ${command} (cwd=${WORKSPACE_DIR})`);
  let logStartOffset = 0;
  try {
    logStartOffset = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
  } catch {
    logStartOffset = 0;
  }
  const logFd = fs.openSync(logPath, "a");

  let child;
  try {
    child = spawn(command, cliArgs, {
      cwd: WORKSPACE_DIR,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
  } catch (err) {
    fs.closeSync(logFd);
    const msg = `spawn failed: ${err.message}`;
    logLine(id, msg);
    blockTicket(id, msg);
    return { launched: false, reason: "spawn_error", error: err.message };
  }

  // Parent shouldn't keep the child fd open or wait on the child.
  fs.closeSync(logFd);
  addRunning(id, child.pid);
  // Record engine + branch + worktree path on the run record (createRun ignores
  // unknown fields on older ledgers, so this is forward-compatible) and log it.
  createRun({
    ticketId: id,
    pid: child.pid,
    logPath,
    logStartOffset,
    branch,
    worktreePath: wt.mode === "worktree" ? wt.path : null,
    role: runRole,
    model: launchedModel,
    engine,
  });
  const where =
    wt.mode === "worktree"
      ? `worktree=${wt.path} (base ${wt.baseRef || wt.baseBranch || "main"})`
      : `in-place (workspace)`;
  logLine(id, `spawned pid=${child.pid} branch=${branch} ${where} [${engine}: ${launchDesc}]`);
  addNote(
    id,
    `run started — ${engine} (${runRole ? `${runRole}, ` : ""}${launchedModel}), branch ${branch}, ${where}`
  );

  // Reflect on the board that this ticket is now being worked. This happens
  // only after the child process is spawned and recorded in WIP, so
  // in_progress always means a session exists.
  try {
    const fresh = readTicket(id) || ticket;
    if (fresh.status !== "in_progress") {
      fresh.status = "in_progress";
      fresh.updated = new Date().toISOString().slice(0, 10);
    }
    clearQueueFields(fresh);
    // Clear any limit-hit pause flag — a new run is now live.
    if (fresh.last_run_limit_hit) {
      delete fresh.last_run_limit_hit;
      fresh.updated = new Date().toISOString().slice(0, 10);
    }
    writeTicket(fresh);
    rewriteIndex();
  } catch (err) {
    logLine(id, `could not set in_progress: ${err.message}`);
  }

  child.on("exit", (code, signal) => {
    removeRunning(id);
    const run = finishRun(child.pid, { code, signal });
    logLine(id, `exited code=${code} signal=${signal ?? "none"}`);
    // When the session was stopped by a usage limit, mark the ticket so the
    // board can offer a Resume button. The worktree + branch are untouched.
    if (run && run.limit_hit && code !== 0) {
      try {
        const t = readTicket(id);
        if (t) {
          if (!Array.isArray(t.notes)) t.notes = [];
          t.notes.push(
            `${new Date().toISOString()} — session paused: usage limit hit ` +
              `(branch: ${run.branch ?? "unknown"}; worktree preserved — use Resume)`,
          );
          if (t.status === "in_progress") {
            t.status = "backlog";
          }
          t.last_run_limit_hit = true;
          t.updated = new Date().toISOString().slice(0, 10);
          writeTicket(t);
          rewriteIndex();
        }
      } catch (err) {
        logLine(id, `could not mark limit hit: ${err.message}`);
      }
    } else {
      revertInProgress(id, `session ended without handoff (code=${code ?? "null"} signal=${signal ?? "none"}) → reverted to backlog`);
      drainQueuedTickets();
    }
  });
  child.on("error", (err) => {
    removeRunning(id);
    finishRun(child.pid, { status: "process_error", signal: err.message });
    logLine(id, `process error: ${err.message}`);
    blockTicket(id, `process error: ${err.message}`);
    drainQueuedTickets();
  });

  // Detach: let the child outlive transient parent state but still track it.
  child.unref();

  return { launched: true, pid: child.pid };
}

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2 };

function queuedTickets() {
  return readAllTickets()
    .filter((t) => t && t.status === "queued" && !isRunning(t.id))
    .sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] ?? 9;
      const pb = PRIORITY_RANK[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return String(a.id).localeCompare(String(b.id));
    });
}

export function drainQueuedTickets() {
  if (!isArmed()) return { launched: 0, checked: 0, reason: "disarmed" };
  const results = [];
  while (runningIds().length < getWipLimit()) {
    const [ticket] = queuedTickets();
    if (!ticket) break;
    const result = launchTicket(ticket, { previousStatus: "queued" });
    results.push({ id: ticket.id, result });
    if (result && result.launched) continue;
    if (
      result &&
      ["blocked", "preflight_failed", "worktree_failed", "spawn_error"].includes(result.reason)
    ) {
      continue;
    }
    break;
  }
  return {
    launched: results.filter((item) => item.result && item.result.launched).length,
    checked: results.length,
    results,
  };
}

// Is a pid still alive? (signal 0 probes without delivering a signal.)
function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Kill the whole process GROUP for a session. Launched sessions are spawned
// detached, so the child is its own process-group leader (pgid === child.pid).
// Targeting `-pid` takes down `claude` AND everything it spawned (bash, tool
// subprocesses, subagents) — killing the bare pid would orphan those. Falls
// back to the single pid if the group send fails.
function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

// stopTicket(id): manually terminate the session working a ticket. Finds the
// live pid (in-memory running set first, then the newest still-"running" ledger
// entry so sessions spawned by a PRIOR server process — reconciled at boot —
// are killable too), SIGTERMs its process group, escalates to SIGKILL after a
// grace period, marks the run "killed", and reverts a still-in_progress ticket
// to backlog (mirrors the scheduler's dead-run recovery). Idempotent: if the
// spawn-owner's own exit handler fires later it finds no "running" run and no-ops.
export function stopTicket(id) {
  let pid = getRunningPid(id);
  if (!pid) {
    const run = getRuns().find((r) => r.ticket_id === id && r.status === "running");
    pid = run ? run.pid : null;
  }
  if (!pid) {
    logLine(id, "stop requested but no live session found");
    return { stopped: false, reason: "not_running" };
  }

  logLine(id, `manual stop requested — SIGTERM to process group ${pid}`);
  killGroup(pid, "SIGTERM");

  // Escalate to SIGKILL if it ignores SIGTERM. Detached timer so the HTTP
  // response returns immediately; unref so it never holds the process open.
  const escalate = setTimeout(() => {
    if (pidAlive(pid)) {
      logLine(id, `pid ${pid} survived SIGTERM — escalating to SIGKILL`);
      killGroup(pid, "SIGKILL");
    }
  }, 4000);
  if (escalate.unref) escalate.unref();

  finishRun(pid, { status: "killed", signal: "SIGTERM" });
  removeRunning(id);

  try {
    const t = readTicket(id);
    if (t && t.status === "in_progress") {
      if (!Array.isArray(t.notes)) t.notes = [];
      t.notes.push(
        `${new Date().toISOString()} — session manually stopped from dashboard (pid ${pid}) → reverted to backlog`
      );
      t.status = "backlog";
      t.updated = new Date().toISOString().slice(0, 10);
      writeTicket(t);
      rewriteIndex();
    }
  } catch (err) {
    logLine(id, `could not revert status after stop: ${err.message}`);
  }

  return { stopped: true, pid };
}
