// CI / merge-conflict watcher (scoped to the autopilot loop). For every ticket
// in `human_review` with a pr_url, it:
//
//   • detects a MERGED PR and auto-advances the ticket human_review -> done
//     (so its dependents unblock and the dependency cascade can proceed),
//   • asks `gh pr checks` whether the PR's checks pass / fail / pending,
//   • asks `gh pr view` whether the PR is CONFLICTING with main,
//   • on a NEWLY-failed PR dispatches a CI-fix session (fix on the same branch),
//   • on a NEWLY-conflicting PR dispatches a conflict-fix session (merge main +
//     resolve on the same branch).
//
// Auto-dispatch only happens when armed AND autopilot AND the breaker is NOT
// tripped AND a WIP slot is free AND under the usage cap AND (require_official
// satisfied) — the same safety envelope the scheduler uses. Fix sessions reuse
// the PR's existing branch/worktree, never open a new PR, and never merge.
//
// manualFix(ticketId) dispatches a fix on demand regardless of autopilot/cap/
// night-window (a human explicitly asked), still refusing only when the breaker
// is tripped or a session is already running for that ticket.
//
// Everything is best-effort and defensive: a missing/!auth'd `gh`, a private
// repo, or a malformed PR url just reads as state "unknown" and dispatches
// nothing.
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import {
  LOGS_DIR,
  WORKSPACE_DIR,
  FIX_CI_PROMPT_REF,
  FIX_CONFLICT_PROMPT_REF,
  TICKETS_REF,
  BOARD_DIR,
  AGENT_MODEL,
  CODEX_BIN,
} from "./paths.js";
import path from "node:path";
import { readAllTickets, readTicket, writeTicket, rewriteIndex } from "./tickets.js";
import {
  isArmed,
  isAutopilot,
  getWipLimit,
  runningIds,
  isRunning,
  addRunning,
  removeRunning,
  getBreaker,
} from "./state.js";
import { createRun, finishRun } from "./runs.js";
import { resolveRole, codexEffort, codexModel } from "./roles.js";
import { resolveEngine, buildClaudeArgs, buildCodexArgs, codexInstruction } from "./engine.js";
import { ensureWorktree } from "./worktrees.js";

const CONFIG_FILE = path.join(BOARD_DIR, "usage.config.json");

// ciWatch[ticketId] = { ticket, pr, state, conflict, fixDispatched,
//                       conflictFixDispatched, lastChecked }
const watch = new Map();

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
    console.error(`[ci-watch] cannot write log for ${id}:`, err.message);
  }
}

function requireOfficial() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return cfg.require_official_usage !== false;
  } catch {
    return true;
  }
}

let ghChecked = null;
function ghAvailable() {
  if (ghChecked !== null) return ghChecked;
  const res = spawnSync("sh", ["-lc", "command -v gh"], { stdio: "ignore" });
  ghChecked = res.status === 0;
  return ghChecked;
}

// Collapse the per-check rollup from `gh pr checks --json` into one state.
// fail wins over pending wins over pass; empty/unknown -> "unknown".
function rollupState(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return "unknown";
  let sawPending = false;
  let sawPass = false;
  for (const c of checks) {
    const bucket = String(c.bucket || "").toLowerCase(); // gh: pass|fail|pending|skipping|cancel
    const state = String(c.state || "").toLowerCase();
    if (bucket === "fail" || ["failure", "error", "timed_out", "cancelled", "action_required"].includes(state)) {
      return "fail";
    }
    if (bucket === "pending" || ["pending", "queued", "in_progress", "waiting", "requested"].includes(state)) {
      sawPending = true;
    }
    if (bucket === "pass" || bucket === "skipping" || ["success", "neutral", "skipped"].includes(state)) {
      sawPass = true;
    }
  }
  if (sawPending) return "pending";
  if (sawPass) return "pass";
  return "unknown";
}

// Query the PR's checks via gh. Returns { state, checks } or { state:"unknown" }.
function fetchPrChecks(pr) {
  if (!ghAvailable()) return { state: "unknown", checks: [] };
  const res = spawnSync(
    "gh",
    ["pr", "checks", String(pr), "--json", "name,state,bucket,link"],
    { cwd: WORKSPACE_DIR, encoding: "utf8", timeout: 30000 }
  );
  const out = (res.stdout || "").trim();
  if (!out) return { state: "unknown", checks: [] };
  let checks;
  try {
    checks = JSON.parse(out);
  } catch {
    return { state: "unknown", checks: [] };
  }
  return { state: rollupState(checks), checks };
}

// Query the PR's merge metadata. Returns { prState, mergeable, mergeStateStatus }
// where prState is OPEN|CLOSED|MERGED and mergeable is MERGEABLE|CONFLICTING|
// UNKNOWN. All "" when gh is unavailable / errors.
function fetchPrMeta(pr) {
  if (!ghAvailable()) return { prState: "", mergeable: "", mergeStateStatus: "" };
  const res = spawnSync(
    "gh",
    ["pr", "view", String(pr), "--json", "state,mergeable,mergeStateStatus"],
    { cwd: WORKSPACE_DIR, encoding: "utf8", timeout: 30000 }
  );
  const out = (res.stdout || "").trim();
  if (!out) return { prState: "", mergeable: "", mergeStateStatus: "" };
  try {
    const j = JSON.parse(out);
    return {
      prState: String(j.state || "").toUpperCase(),
      mergeable: String(j.mergeable || "").toUpperCase(),
      mergeStateStatus: String(j.mergeStateStatus || "").toUpperCase(),
    };
  } catch {
    return { prState: "", mergeable: "", mergeStateStatus: "" };
  }
}

// A PR is conflicting when GitHub says CONFLICTING (authoritative) or the merge
// state is DIRTY. UNKNOWN is transient (GitHub still computing) — not a conflict.
function isConflicting(meta) {
  return meta.mergeable === "CONFLICTING" || meta.mergeStateStatus === "DIRTY";
}

// Branch name matching launcher.js convention.
function branchForTicket(ticket) {
  if (ticket.branch) return ticket.branch;
  const slug = String(ticket.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-");
  return slug ? `ticket/${ticket.id}-${slug}` : `ticket/${ticket.id}`;
}

// Derive the repo name from a GitHub PR URL (…/<owner>/<repo>/pull/N).
function repoFromPrUrl(url) {
  const m = String(url || "").match(/github\.com\/[^/]+\/([^/]+)\/pull\/\d+/);
  return m ? m[1] : null;
}

// Every PR a ticket owns. A cross-repo (workspace) ticket opens one PR per repo,
// so read the `pr_urls` array (preferred) and union with the single `pr_url`.
// Deduped, order preserved. This is why a second PR no longer goes untracked.
function prsForTicket(ticket) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  };
  if (Array.isArray(ticket.pr_urls)) for (const u of ticket.pr_urls) push(u);
  push(ticket.pr_url);
  return out;
}

// Dispatch a fix session on a SPECIFIC PR's existing branch/worktree. kind is
// "ci-fix" (fix failing checks, points at fix-ci-prompt.md) or "conflict-fix"
// (merge main + resolve, points at fix-conflict-prompt.md). `prUrl` is the PR to
// fix and `repo` the repo it lives in (derived from the URL for cross-repo
// tickets). Returns { launched, pid } or { launched:false, reason }.
function dispatchFixSession(ticket, kind, prUrl, repo) {
  const id = ticket.id;
  if (isRunning(id)) return { launched: false, reason: "already_running" };

  const targetRepo = repo || repoFromPrUrl(prUrl) || ticket.repo;
  const branch = branchForTicket(ticket);
  const wt = ensureWorktree({
    repo: targetRepo,
    ticketId: id,
    branch,
    reuse: true, // the PR branch already exists — attach, don't recreate.
  });
  if (wt.error) {
    logLine(id, `${kind} worktree setup failed: ${wt.error}`);
    return { launched: false, reason: "worktree_failed", error: wt.error };
  }

  const promptFile = kind === "conflict-fix" ? FIX_CONFLICT_PROMPT_REF : FIX_CI_PROMPT_REF;
  const job =
    kind === "conflict-fix"
      ? `merge-conflict-fix session. Read ${FIX_CONFLICT_PROMPT_REF} and follow it EXACTLY to resolve the merge conflict with the base branch on the open PR`
      : `CI-fix session. Read ${FIX_CI_PROMPT_REF} and follow it EXACTLY to fix the failing CI on the open PR`;

  let worktreeNote;
  if (wt.mode === "worktree") {
    worktreeNote =
      ` WORKTREE: your isolated ${targetRepo} checkout is on the PR's existing branch ` +
      `"${branch}" at ${wt.path}. cd into that path for all ${targetRepo} code and git ` +
      `work; do NOT create another branch and do NOT open a new PR. ${TICKETS_REF}/${id}.json ` +
      `updates still happen in the workspace at ${WORKSPACE_DIR}/${TICKETS_REF}.`;
  } else {
    worktreeNote =
      ` WORKTREE: workspace-repo ticket — the PR's branch "${branch}" is checked out in ` +
      `place at the workspace root (${WORKSPACE_DIR}). Do code + git work there; do NOT ` +
      `open a new PR.`;
  }

  const engine = resolveEngine(ticket);
  const role = resolveRole(ticket);

  const instruction =
    `ENGINE: ${engine}. You are an autonomous ${job} for ticket ${id} at ${TICKETS_REF}/${id}.json ` +
    `(repo: ${targetRepo}, PR: ${prUrl}). Work on the SAME branch, push, leave a ` +
    `note. Do NOT open a new PR. Do NOT merge the PR.` +
    worktreeNote;

  // A fix session follows the ticket's engine, built through the same engine.js
  // seam as a fresh launch. Claude fix sessions run on AGENT_MODEL with no
  // persona file (--model only); Codex fix sessions get the role persona
  // prepended + reasoning effort by role.
  let command;
  let args;
  let runModel;
  if (engine === "codex") {
    const effort = codexEffort(ticket);
    const cmodel = codexModel(ticket);
    command = CODEX_BIN;
    args = buildCodexArgs({
      instruction: codexInstruction(role, instruction),
      model: cmodel,
      effort,
      cwd: WORKSPACE_DIR,
    });
    runModel = cmodel;
  } else {
    command = "claude";
    args = buildClaudeArgs({
      useAgent: false,
      explicitModel: AGENT_MODEL,
      agentModel: AGENT_MODEL,
      instruction,
    });
    runModel = AGENT_MODEL;
  }

  ensureLogsDir();
  const logPath = `${LOGS_DIR}/${id}.log`;
  const logFd = fs.openSync(logPath, "a");
  logLine(id, `${kind} launching (${engine}, model ${runModel}) for PR ${prUrl} [repo ${targetRepo}, ${promptFile}]`);

  let child;
  try {
    child = spawn(command, args, { cwd: WORKSPACE_DIR, detached: true, stdio: ["ignore", logFd, logFd] });
  } catch (err) {
    fs.closeSync(logFd);
    logLine(id, `${kind} spawn failed: ${err.message}`);
    return { launched: false, reason: "spawn_error", error: err.message };
  }

  fs.closeSync(logFd);
  addRunning(id, child.pid);
  createRun({
    ticketId: id,
    pid: child.pid,
    logPath,
    branch,
    worktreePath: wt.mode === "worktree" ? wt.path : null,
    // Attribute the fix-session spend to the ticket's role + the engine/model
    // these sessions actually run on, so it shows under the role in the Agents
    // tab instead of the "unknown" bucket.
    role,
    model: runModel,
    engine,
    kind,
  });
  logLine(id, `${kind} spawned pid=${child.pid} branch=${branch} [${engine}]`);

  child.on("exit", (code, signal) => {
    removeRunning(id);
    finishRun(child.pid, { code, signal });
    logLine(id, `${kind} exited code=${code} signal=${signal ?? "none"}`);
  });
  child.on("error", (err) => {
    removeRunning(id);
    finishRun(child.pid, { status: "process_error", signal: err.message });
    logLine(id, `${kind} process error: ${err.message}`);
  });
  child.unref();

  return { launched: true, pid: child.pid };
}

// Advance a merged PR's ticket human_review -> done so its dependents unblock.
// Idempotent: only acts on a human_review ticket; once done it leaves the watch
// set on the next poll (the filter only keeps human_review).
function autoAdvanceToDone(ticket) {
  const id = ticket.id;
  try {
    const fresh = readTicket(id) || ticket;
    if (fresh.status !== "human_review") return false;
    fresh.status = "done";
    fresh.updated = new Date().toISOString().slice(0, 10);
    writeTicket(fresh);
    rewriteIndex();
    logLine(id, `ci-watch: all PRs merged — ticket auto-advanced to done (dependents may unblock)`);
    return true;
  } catch (err) {
    logLine(id, `ci-watch: auto-advance-to-done failed: ${err.message}`);
    return false;
  }
}

// runCiWatch(usage): poll every human_review+pr ticket, refresh the cache, and
// (when allowed) auto-advance merged PRs + dispatch CI-fix / conflict-fix.
// `usage` is the current getUsage() result so we honour the same cap the
// scheduler uses without re-scanning transcripts.
export function runCiWatch(usage, _options = {}) {
  const tickets = readAllTickets().filter(
    (t) => t && t.status === "human_review" && prsForTicket(t).length
  );

  // Cache is keyed by PR URL (a ticket can own several). Drop entries for PRs no
  // longer under review.
  const livePrs = new Set();
  for (const t of tickets) for (const u of prsForTicket(t)) livePrs.add(u);
  for (const key of [...watch.keys()]) {
    if (!livePrs.has(key)) watch.delete(key);
  }

  const armed = isArmed();
  const autopilot = isAutopilot();
  const breakerTripped = !!(getBreaker() && getBreaker().tripped);
  const wip = getWipLimit();
  const block = usage && usage.block ? usage.block : null;
  const capPct = block && block.cap && block.cap.capPct != null ? block.cap.capPct : 1.0;
  const blockPct = block && block.pct != null ? block.pct : 0;
  const official = !!(block && block.pctSource === "official");
  const needOfficial = requireOfficial();

  for (const ticket of tickets) {
    const id = ticket.id;
    const prs = prsForTicket(ticket);
    let allMerged = true;

    for (const pr of prs) {
      const repo = repoFromPrUrl(pr) || ticket.repo;
      const prev = watch.get(pr) || { fixDispatched: false, conflictFixDispatched: false };

      // 1) Merged? drop from watch; this PR is done.
      const meta = fetchPrMeta(pr);
      if (meta.prState === "MERGED") {
        watch.delete(pr);
        continue;
      }
      allMerged = false; // at least one PR still open

      // 2) Determine CI + conflict state.
      const { state: ciState } = fetchPrChecks(pr);
      const conflict = isConflicting(meta);
      const displayState = conflict ? "conflict" : ciState;

      // Auto-dispatch is allowed only inside the scheduler's safety envelope.
      // isRunning(id) also serialises fixes per ticket: a cross-repo ticket's
      // second PR-fix waits until the first finishes (one session per ticket id).
      const slotFree = runningIds().length < wip;
      const underCap = blockPct < capPct;
      const usageOk = official || !needOfficial;
      const autoAllowed =
        armed && autopilot && !breakerTripped && slotFree && underCap && usageOk && !isRunning(id);

      let fixDispatched = !!prev.fixDispatched;
      let conflictFixDispatched = !!prev.conflictFixDispatched;

      // 3) Conflict takes priority (CI is meaningless on an un-mergeable branch).
      if (conflict && !prev.conflict && !conflictFixDispatched) {
        if (autoAllowed) {
          const r = dispatchFixSession(ticket, "conflict-fix", pr, repo);
          if (r.launched) {
            conflictFixDispatched = true;
            logLine(id, `ci-watch: PR ${pr} newly CONFLICTING — conflict-fix dispatched (pid ${r.pid})`);
          } else {
            logLine(id, `ci-watch: PR ${pr} conflicting but fix not dispatched (${r.reason})`);
          }
        } else {
          logLine(id, `ci-watch: PR ${pr} conflicting — fix held (${holdReason(armed, autopilot, breakerTripped, slotFree, underCap, usageOk, isRunning(id))})`);
        }
      } else if (!conflict && ciState === "fail" && prev.state !== "fail" && !fixDispatched) {
        // 4) Newly-failed CI (and not conflicting).
        if (autoAllowed) {
          const r = dispatchFixSession(ticket, "ci-fix", pr, repo);
          if (r.launched) {
            fixDispatched = true;
            logLine(id, `ci-watch: PR ${pr} newly failed — CI-fix dispatched (pid ${r.pid})`);
          } else {
            logLine(id, `ci-watch: PR ${pr} newly failed but fix not dispatched (${r.reason})`);
          }
        } else {
          logLine(id, `ci-watch: PR ${pr} newly failed — fix held (${holdReason(armed, autopilot, breakerTripped, slotFree, underCap, usageOk, isRunning(id))})`);
        }
      }

      // Reset latches once the condition clears so a future regression re-arms it.
      if (ciState === "pass") fixDispatched = false;
      if (!conflict) conflictFixDispatched = false;

      watch.set(pr, {
        ticket: id,
        repo,
        pr,
        state: displayState, // pass | fail | pending | conflict | unknown
        conflict,
        fixDispatched,
        conflictFixDispatched,
        lastChecked: new Date().toISOString(),
      });
    }

    // Auto-advance ONLY when every PR the ticket owns is merged.
    if (prs.length && allMerged) autoAdvanceToDone(ticket);
  }

  return ciWatchList();
}

function holdReason(armed, autopilot, breakerTripped, slotFree, underCap, usageOk, ticketRunning) {
  if (!armed) return "disarmed";
  if (breakerTripped) return "breaker tripped";
  if (!autopilot) return "autopilot off";
  if (ticketRunning) return "a session for this ticket is already running";
  if (!slotFree) return "WIP full";
  if (!underCap) return "over cap";
  if (!usageOk) return "live usage unavailable (fail-safe)";
  return "held";
}

// manualFix(ticketId, opts?): dispatch a fix on demand. Bypasses autopilot /
// night-window / cap (a human explicitly clicked), but refuses if the breaker
// is tripped (usage limit) or a session is already running. opts:
//   { kind?: "ci-fix"|"conflict-fix", pr?: <pr url> }
// `pr` selects WHICH PR to fix (cross-repo tickets own several); defaults to the
// ticket's first PR. `kind` defaults to auto-detect from that PR's cached state.
// Returns { launched, pid, kind, pr } | { launched:false, reason }.
export function manualFix(ticketId, opts = {}) {
  const ticket = readTicket(ticketId);
  if (!ticket) return { launched: false, reason: "no_such_ticket" };
  if (ticket.status !== "human_review") return { launched: false, reason: "not_in_review" };
  const prs = prsForTicket(ticket);
  if (!prs.length) return { launched: false, reason: "no_pr" };
  if (getBreaker() && getBreaker().tripped) return { launched: false, reason: "breaker_tripped" };
  if (isRunning(ticketId)) return { launched: false, reason: "already_running" };

  const pr = opts.pr && prs.includes(opts.pr) ? opts.pr : prs[0];
  const repo = repoFromPrUrl(pr) || ticket.repo;
  let useKind = opts.kind;
  if (useKind !== "ci-fix" && useKind !== "conflict-fix") {
    const cached = watch.get(pr);
    useKind = cached && cached.conflict ? "conflict-fix" : "ci-fix";
  }

  const result = dispatchFixSession(ticket, useKind, pr, repo);
  if (result.launched) {
    const cur = watch.get(pr) || { ticket: ticketId, repo, pr };
    if (useKind === "conflict-fix") cur.conflictFixDispatched = true;
    else cur.fixDispatched = true;
    watch.set(pr, { ...cur, lastChecked: new Date().toISOString() });
    logLine(ticketId, `manual ${useKind} dispatched for PR ${pr} (pid ${result.pid})`);
  } else {
    logLine(ticketId, `manual ${useKind} refused: ${result.reason}`);
  }
  return { ...result, kind: useKind, pr };
}

// The list GET /api/scheduler exposes as `ciWatch`.
export function ciWatchList() {
  return [...watch.values()].map((c) => ({
    ticket: c.ticket,
    repo: c.repo || null,
    pr: c.pr,
    state: c.state,
    conflict: !!c.conflict,
    fixDispatched: !!c.fixDispatched,
    conflictFixDispatched: !!c.conflictFixDispatched,
    // The UI enables a manual "Fix" button when there's something to fix.
    fixable: c.state === "fail" || c.state === "conflict",
    lastChecked: c.lastChecked,
  }));
}
