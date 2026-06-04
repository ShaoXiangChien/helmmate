// Usage-aware continuous scheduler. start(server) installs a setInterval that
// fires every `poll_interval_min` (usage.config.json, default 20 min). Each
// tick:
//
//   1. Build the scheduler status (mode day/night + active cap, from the usage
//      probe's clock-derived cap).
//   2. If !armed -> record a "paused" decision and return. If armed, drain
//      queued human launch requests before applying autopilot gates.
//   3. If !autopilot -> record a "paused" decision and return.
//   4. usage = getUsage(); if the block is at/over the active cap -> record
//      "paused: usage X% >= cap" and return.
//   5. While a WIP slot is free, pick the next AUTOPILOT-ELIGIBLE ticket
//      (status "backlog" only — triage needs human approval), deps all done,
//      repo is configured, has acceptance_criteria,
//      not running, not blocked; ordered by priority then id. Estimate its
//      tokens; if dispatching it would push the block over the cap, skip it and
//      stop. Else launchTicket() and record "dispatched". Re-read usage between
//      dispatches.
//   6. Keep the last ~30 decisions for GET /api/scheduler.
//   7. Run the CI watcher.
//
// The board never self-launches unless armed AND autopilot are both on, so this
// is inert by default (autopilot defaults false).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getUsage } from "./usage.js";
import { refreshOfficialUsage } from "./official-usage.js";
import { readAllTickets, ticketsById, depsSatisfied, readTicket, writeTicket, rewriteIndex } from "./tickets.js";
import {
  isArmed,
  isAutopilot,
  getWipLimit,
  runningIds,
  isRunning,
  getBreaker,
  tripBreaker,
  clearBreakerIfExpired,
  removeRunning,
} from "./state.js";
import { drainQueuedTickets, launchTicket } from "./launcher.js";
import { isOpus } from "./roles.js";
import { assessTicket } from "./preflight.js";
import { estimateTicketTokens, buildCostModel } from "./cost-model.js";
import { runCiWatch, ciWatchList } from "./ci-watch.js";
import { getRuns, reconcileRuns } from "./runs.js";
import { REPO_KEYS } from "./paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); // .../helmmate/lib
const BOARD_DIR = path.resolve(__dirname, "..");
const CONFIG_FILE = path.join(BOARD_DIR, "usage.config.json");

const DEFAULT_POLL_MIN = 20;
const DEFAULT_DAY_WINDOW = [8, 24];
const DEFAULT_DAY_CAP = 0.8;
const DEFAULT_NIGHT_CAP = 1.0;
const MAX_DECISIONS = 30;
const VALID_REPOS = new Set(REPO_KEYS);
const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2 };
// CI / merge-conflict watching runs on its OWN fast cadence, decoupled from the
// 20-min dispatch tick, so conflicts + CI failures surface (and auto-fix fires)
// within ~90s instead of up to 20 min.
const CI_WATCH_INTERVAL_MS = 90 * 1000;

// Module state for the running interval + decision ring buffer.
const sched = {
  timer: null,
  ciTimer: null,
  decisions: [], // [{ ts, action, ticket, reason }]
  lastTickAt: null,
  nextTickAt: null,
  lastCiWatchAt: null,
  pollIntervalMin: DEFAULT_POLL_MIN,
  lastLimitScanAt: 0, // epoch ms; runs that ended after this are scanned for limit hits
};

// night_only (default true): autopilot dispatches ONLY during the night window
// (the complement of day_window_hours). Manual drag-to-In-Progress is never
// gated by this — it only constrains the autonomous scheduler.
function nightOnly(cfg) {
  return cfg.night_only !== false;
}

// require_official_usage (default true): autopilot dispatches ONLY when the live
// Anthropic usage % is available. If the endpoint is down (429/offline) and
// getUsage fell back to the local transcript estimate, we FAIL SAFE and pause —
// the estimate can read far too low and let an unattended run blow past the real
// limit. Set false to (dangerously) trust the estimate.
function requireOfficial(cfg) {
  return cfg.require_official_usage !== false;
}

// weekly_cap_pct (default 0.95): pause dispatch when the REAL 7-day utilization
// reaches this fraction. The 5h window can be wide open while the weekly limit
// is the binding one — gate on both.
function weeklyCap(cfg) {
  const v = Number(cfg.weekly_cap_pct);
  return Number.isFinite(v) && v > 0 ? v : 0.95;
}

// opus_cap_pct (default 0.5): a STRICTER ceiling for tickets that would run on
// Opus (the architect role or an explicit opus opt-up). Opus burns ~5x the
// budget, so it's held to a tighter cap than Sonnet work — an unattended night
// run can keep dispatching cheap Sonnet tickets up to the normal 5h/weekly caps
// but won't drain the week on Opus once usage passes this fraction.
function opusCap(cfg) {
  const v = Number(cfg.opus_cap_pct);
  return Number.isFinite(v) && v > 0 ? v : 0.5;
}

// preflight_triage (default true): run a cheap Haiku triage pass before
// dispatching a full session; a confident "not ready" bounces the ticket to
// triage instead of wasting a Sonnet/Opus run. Fail-open (see lib/preflight.js).
function preflightEnabled(cfg) {
  return cfg.preflight_triage !== false;
}

// Bounce a ticket back to triage with a note (used by pre-flight). Reversible —
// A human can re-approve to backlog after sharpening it.
function triageTicket(id, note) {
  try {
    const t = readTicket(id);
    if (!t) return;
    if (!Array.isArray(t.notes)) t.notes = [];
    t.notes.push(`${new Date().toISOString()} — ${note}`);
    t.status = "triage";
    t.updated = new Date().toISOString().slice(0, 10);
    writeTicket(t);
    rewriteIndex();
  } catch {
    /* best effort */
  }
}

// Scan finished runs for a usage-limit hit and trip the breaker if found. The
// limit flag is set by runs.js, scoped to the CLI's own error events. Trips
// until the active block's reset time so it auto-clears when usage resets.
function scanForLimitHit(usage) {
  let tripped = false;
  for (const run of getRuns()) {
    if (!run.limit_hit || !run.ended_at) continue;
    const endedMs = Date.parse(run.ended_at);
    if (!Number.isFinite(endedMs) || endedMs <= sched.lastLimitScanAt) continue;
    const until = usage && usage.block ? usage.block.resetTime : null;
    tripBreaker({ until, reason: `usage limit hit on ${run.ticket_id}` });
    recordDecision("paused", run.ticket_id, `circuit breaker tripped — usage limit; paused until ${until || "manual reset"}`);
    tripped = true;
  }
  sched.lastLimitScanAt = Date.now();
  return tripped;
}

// Mark runs whose process has died as "lost". The ledger only learns of a
// child's exit from the SERVER THAT SPAWNED IT — a server restart orphans live
// children, so when they later die nothing fires finishRun and they linger as
// phantom "running" (the 7h+ "running" entries are exactly this). This sweeps
// them: marks the dead run lost, drops it from the in-memory running set, and
// reverts a still-`in_progress` ticket back to `backlog` so it can be retried.
// `minIntervalMs` throttles the cheap read-path caller.
let lastSweepAt = 0;
function sweepDeadRuns(minIntervalMs = 0) {
  const now = Date.now();
  if (minIntervalMs && now - lastSweepAt < minIntervalMs) return;
  lastSweepAt = now;
  const before = new Set(getRuns().filter((r) => r.status === "running").map((r) => r.ticket_id));
  if (!before.size) return;
  const aliveIds = new Set(reconcileRuns().map((r) => r.ticket_id)); // marks dead 'running' -> 'lost'
  for (const id of before) {
    if (aliveIds.has(id)) continue; // a live run still exists for this ticket
    removeRunning(id);
    try {
      const t = readTicket(id);
      if (t && t.status === "in_progress") {
        t.status = "backlog";
        t.updated = new Date().toISOString().slice(0, 10);
        writeTicket(t);
        rewriteIndex();
        recordDecision("recovered", id, "session died — reverted in_progress → backlog for retry");
      }
    } catch {
      /* best effort */
    }
  }
}

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (raw && typeof raw === "object") return raw;
  } catch {
    /* fall through to defaults */
  }
  return {};
}

function pollIntervalMin(cfg) {
  const v = Number(cfg.poll_interval_min);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_POLL_MIN;
}

// Clock-derived mode + cap. Prefer the usage probe's cap (single source of
// truth — it already computes day/night from the same config); fall back to a
// local computation if the probe didn't supply one.
function modeAndCap(cfg, usage) {
  const block = usage && usage.block ? usage.block : null;
  if (block && block.cap && typeof block.cap.capPct === "number") {
    return {
      mode: block.cap.isDay ? "day" : "night",
      capPct: block.cap.capPct,
    };
  }
  const [startH, endH] = Array.isArray(cfg.day_window_hours) ? cfg.day_window_hours : DEFAULT_DAY_WINDOW;
  const hour = new Date().getHours();
  let isDay;
  if (startH <= endH) isDay = hour >= startH && hour < endH;
  else isDay = hour >= startH || hour < endH;
  const dayCap = Number.isFinite(Number(cfg.day_cap_pct)) ? Number(cfg.day_cap_pct) : DEFAULT_DAY_CAP;
  const nightCap = Number.isFinite(Number(cfg.night_cap_pct)) ? Number(cfg.night_cap_pct) : DEFAULT_NIGHT_CAP;
  return { mode: isDay ? "day" : "night", capPct: isDay ? dayCap : nightCap };
}

function recordDecision(action, ticket, reason) {
  sched.decisions.push({
    ts: new Date().toISOString(),
    action,
    ticket: ticket || null,
    reason: reason || "",
  });
  if (sched.decisions.length > MAX_DECISIONS) {
    sched.decisions.splice(0, sched.decisions.length - MAX_DECISIONS);
  }
}

// Optional allowlist: when usage.config.json has a non-empty
// `autopilot_allowlist`, autopilot dispatches ONLY those ticket ids. This is the
// safe way to constrain an unattended run to a curated, genuinely-independent
// set (ticket `dependencies` are currently unpopulated, so depsSatisfied can't
// enforce ordering on its own). Empty/absent → all backlog tickets eligible.
function allowlistSet(cfg) {
  const a = cfg && cfg.autopilot_allowlist;
  return Array.isArray(a) && a.length ? new Set(a.map(String)) : null;
}

// Autopilot eligibility: status "backlog" ONLY (triage needs human approval),
// on the allowlist (if one is set), deps all "done", known repo, has
// acceptance_criteria, not running, not blocked. Ordered by priority then id.
function eligibleTickets() {
  const cfg = readConfig();
  const allow = allowlistSet(cfg);
  const all = readAllTickets();
  const byId = ticketsById();
  const eligible = all.filter((t) => {
    if (!t || t.status !== "backlog") return false; // backlog only
    if (allow && !allow.has(String(t.id))) return false; // curated set only
    if (!VALID_REPOS.has(t.repo)) return false;
    if (!Array.isArray(t.acceptance_criteria) || t.acceptance_criteria.length === 0) return false;
    if (isRunning(t.id)) return false;
    if (!depsSatisfied(t, byId)) return false;
    return true;
  });
  eligible.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 9;
    const pb = PRIORITY_RANK[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return String(a.id).localeCompare(String(b.id));
  });
  return eligible;
}

// One scheduling tick. Pure of the timer so it can be unit-tested / called once.
export async function tick() {
  sched.lastTickAt = new Date().toISOString();
  // Clear any phantom "running" entries (orphaned dead children) before we read
  // WIP / dispatch, so the slot count is accurate.
  sweepDeadRuns();
  const cfg = readConfig();
  sched.pollIntervalMin = pollIntervalMin(cfg);
  sched.nextTickAt = new Date(Date.now() + sched.pollIntervalMin * 60000).toISOString();

  // Pull the authoritative usage % from Anthropic's endpoint BEFORE gating, so
  // the cap decision uses real utilization (not the transcript estimate). Best
  // effort — getUsage() falls back to the estimate if this didn't land.
  await refreshOfficialUsage();
  let usage = getUsage({ force: true });
  const { mode, capPct } = modeAndCap(cfg, usage);

  // Detect a fresh usage-limit hit and (if any) trip the breaker. Auto-clear an
  // expired breaker first so a new block can resume.
  clearBreakerIfExpired();
  scanForLimitHit(usage);

  // GATE 0: circuit breaker. While tripped, NO dispatch (autopilot is also
  // forced off by tripBreaker). This is the hard usage-limit stop.
  const breaker = getBreaker();
  if (breaker.tripped) {
    recordDecision("paused", null, `circuit breaker: ${breaker.reason || "usage limit"} (until ${breaker.until || "manual reset"})`);
    safeCiWatch(usage);
    return;
  }

  // GATE 1: must be armed AND on autopilot.
  if (!isArmed()) {
    recordDecision("paused", null, "disarmed");
    // Still refresh CI state so the UI stays current even when not dispatching.
    safeCiWatch(usage);
    return;
  }

  const drained = drainQueuedTickets();
  if (drained.launched > 0) {
    recordDecision("dispatched", null, `queued launch drain: ${drained.launched} launched`);
  }

  if (!isAutopilot()) {
    const reason = "autopilot off";
    recordDecision("paused", null, reason);
    // Still refresh CI state so the UI stays current even when not dispatching.
    safeCiWatch(usage);
    return;
  }

  // GATE 1.5: night-only. The autonomous scheduler dispatches only at night.
  if (nightOnly(cfg) && mode === "day") {
    recordDecision("paused", null, "night-only: waiting for night window (00:00–08:00)");
    safeCiWatch(usage);
    return;
  }

  let block = usage && usage.block ? usage.block : null;
  const weekly = usage && usage.weekly ? usage.weekly : null;

  // GATE 1.7: FAIL SAFE on unverified usage. If the live Anthropic % is
  // unavailable (endpoint 429/offline → getUsage fell back to the local
  // ESTIMATE), refuse to dispatch — the estimate can read far too low and let an
  // unattended run blow past the real limit. Override: require_official_usage=false.
  if (requireOfficial(cfg) && (!block || block.pctSource !== "official")) {
    const why = block && block.officialError ? block.officialError : "no live usage data";
    recordDecision("paused", null, `fail-safe: live usage % unavailable (${why}) — not trusting estimate`);
    safeCiWatch(usage);
    return;
  }

  // GATE 2: 5-hour usage cap (REAL utilization).
  let blockPct = block && typeof block.pct === "number" ? block.pct : 0;
  if (blockPct >= capPct) {
    recordDecision("paused", null, `5h usage ${(blockPct * 100).toFixed(0)}% >= cap ${(capPct * 100).toFixed(0)}%`);
    safeCiWatch(usage);
    return;
  }

  // GATE 2.5: 7-day (weekly) usage cap (REAL utilization). The 5h window can be
  // wide open while the weekly limit is the binding one.
  const wCap = weeklyCap(cfg);
  if (weekly && weekly.pctSource === "official" && typeof weekly.pct === "number" && weekly.pct >= wCap) {
    recordDecision("paused", null, `weekly usage ${(weekly.pct * 100).toFixed(0)}% >= weekly cap ${(wCap * 100).toFixed(0)}%`);
    safeCiWatch(usage);
    return;
  }

  // GATE 3: dispatch loop while WIP slots are free.
  const model = buildCostModel(); // one ledger read for all estimates this tick.
  const queue = eligibleTickets();
  let qi = 0;

  while (runningIds().length < getWipLimit() && qi < queue.length) {
    const ticket = queue[qi++];

    // Re-read usage between dispatches so a launch's spend is reflected. (The
    // official % only re-fetches once per ~60s, so within one tick this is
    // stable; concurrency is bounded by the WIP limit regardless.)
    usage = getUsage({ force: true });
    block = usage && usage.block ? usage.block : null;
    const wk = usage && usage.weekly ? usage.weekly : null;
    const official = block && block.pctSource === "official";
    blockPct = block && typeof block.pct === "number" ? block.pct : 0;

    // Fail-safe again mid-loop: if we lost live usage, stop dispatching.
    if (requireOfficial(cfg) && !official) {
      recordDecision("paused", null, "fail-safe: live usage % unavailable mid-dispatch");
      break;
    }
    if (blockPct >= capPct) {
      recordDecision("paused", null, `5h usage ${(blockPct * 100).toFixed(0)}% >= cap ${(capPct * 100).toFixed(0)}%`);
      break;
    }
    if (wk && wk.pctSource === "official" && typeof wk.pct === "number" && wk.pct >= wCap) {
      recordDecision("paused", null, `weekly usage ${(wk.pct * 100).toFixed(0)}% >= weekly cap ${(wCap * 100).toFixed(0)}%`);
      break;
    }

    // Opus budget gate: hold Opus tickets (architect role / opus opt-up) to a
    // stricter cap so they can't drain the weekly budget. SKIP just this ticket
    // (continue, not break) — cheaper Sonnet candidates further down the queue
    // still dispatch normally.
    if (isOpus(ticket)) {
      const oCap = opusCap(cfg);
      if (blockPct >= oCap) {
        recordDecision("skipped", ticket.id, `opus held: 5h ${(blockPct * 100).toFixed(0)}% >= opus cap ${(oCap * 100).toFixed(0)}%`);
        continue;
      }
      if (wk && wk.pctSource === "official" && typeof wk.pct === "number" && wk.pct >= oCap) {
        recordDecision("skipped", ticket.id, `opus held: weekly ${(wk.pct * 100).toFixed(0)}% >= opus cap ${(oCap * 100).toFixed(0)}%`);
        continue;
      }
    }

    const est = estimateTicketTokens(ticket, { model });
    // The local-token "fit" check is only meaningful in estimate mode; under the
    // official % regime the real cap above is authoritative, so skip it.
    if (!official) {
      const effectiveBudget = block && block.effectiveBudget ? block.effectiveBudget : null;
      const tokensMetric = block && block.metricTokens != null ? block.metricTokens : 0;
      if (effectiveBudget && (tokensMetric + est.tokens) / effectiveBudget > capPct) {
        recordDecision(
          "skipped",
          ticket.id,
          `would exceed cap (estimate): ${tokensMetric}+${est.tokens} > ${Math.round(effectiveBudget * capPct)}`
        );
        break;
      }
    }

    // Pre-flight triage (Haiku, fail-open): don't spend a full session on an
// under-specified ticket — bounce it to triage for a human to sharpen. Only a
    // confident not-ready verdict triages; any error/timeout passes through.
    if (preflightEnabled(cfg)) {
      const pf = await assessTicket(ticket);
      if (!pf.ready) {
        triageTicket(ticket.id, `pre-flight (haiku): under-specified → triage — ${pf.reason}`);
        recordDecision("triaged", ticket.id, `pre-flight not-ready → triage: ${pf.reason}`);
        continue; // try the next candidate
      }
    }

    const result = launchTicket(ticket);
    if (result && result.launched) {
      recordDecision("dispatched", ticket.id, `est ~${est.tokens} tok (${est.basis})`);
    } else {
      recordDecision("skipped", ticket.id, `launch refused: ${result ? result.reason : "unknown"}`);
      // Don't spin on the same un-launchable ticket; move to the next candidate.
    }
  }

  safeCiWatch(usage);
}

function safeCiWatch(usage) {
  try {
    runCiWatch(usage);
    sched.lastCiWatchAt = new Date().toISOString();
  } catch (err) {
    console.error("[scheduler] ci-watch failed:", err.message);
  }
}

// Dedicated fast CI-watch pass (every CI_WATCH_INTERVAL_MS), independent of the
// 20-min dispatch tick. Refreshes the live usage % first so auto-fix honours the
// real cap, sweeps dead runs, then polls PRs + dispatches CI/conflict fixes.
async function ciWatchTick() {
  try {
    await refreshOfficialUsage();
  } catch {
    /* fall back to estimate inside getUsage */
  }
  try {
    sweepDeadRuns();
    const usage = getUsage();
    safeCiWatch(usage);
  } catch (err) {
    console.error("[scheduler] ci-watch tick failed:", err.message);
  }
}

// Status object for GET /api/scheduler. Tolerant: callable before the first
// tick has run.
export function getSchedulerStatus() {
  // Self-heal phantom "running" entries on the dashboard's poll (throttled).
  sweepDeadRuns(30000);
  const cfg = readConfig();
  let usage = null;
  try {
    usage = getUsage();
  } catch {
    /* leave null */
  }
  const { mode, capPct } = modeAndCap(cfg, usage);
  const pollMin = pollIntervalMin(cfg);

  let nextPollInSec = pollMin * 60;
  if (sched.nextTickAt) {
    const secs = Math.round((Date.parse(sched.nextTickAt) - Date.now()) / 1000);
    if (Number.isFinite(secs)) nextPollInSec = Math.max(0, secs);
  }

  return {
    autopilot: isAutopilot(),
    armed: isArmed(),
    wipLimit: getWipLimit(),
    running: runningIds(),
    mode,
    nightOnly: nightOnly(cfg),
    activeCapPct: capPct,
    breaker: getBreaker(),
    pollIntervalMin: pollMin,
    nextPollInSec,
    lastTickAt: sched.lastTickAt,
    lastCiWatchAt: sched.lastCiWatchAt,
    ciWatchIntervalSec: Math.round(CI_WATCH_INTERVAL_MS / 1000),
    lastDecisions: sched.decisions.slice(-MAX_DECISIONS),
    ciWatch: ciWatchList(),
  };
}

// start(server): install the recurring tick. Idempotent — calling twice is a
// no-op. `server` is accepted for parity with the contract / future use (e.g.
// closing the interval on server shutdown) but not required.
export function start(server) {
  if (sched.timer) return sched;
  // Only react to limit-hits from runs that END after the server starts — never
  // re-trip on stale history (a persisted breaker is restored separately by
  // loadState, so a genuine active trip survives restart).
  sched.lastLimitScanAt = Date.now();
  const cfg = readConfig();
  sched.pollIntervalMin = pollIntervalMin(cfg);
  const intervalMs = sched.pollIntervalMin * 60000;

  // Run one tick shortly after boot so the UI has data without waiting a full
  // interval, then settle into the configured cadence.
  setTimeout(() => safeTick(), 2000);
  sched.timer = setInterval(safeTick, intervalMs);
  if (sched.timer.unref) sched.timer.unref(); // don't keep the process alive on its own.

  // Fast, independent CI/conflict watch so the dashboard + auto-fix react within
  // ~90s rather than waiting for the 20-min dispatch tick.
  setTimeout(() => ciWatchTick(), 4000);
  sched.ciTimer = setInterval(ciWatchTick, CI_WATCH_INTERVAL_MS);
  if (sched.ciTimer.unref) sched.ciTimer.unref();

  if (server && typeof server.on === "function") {
    server.on("close", stop);
  }
  console.log(
    `[scheduler] started — dispatch every ${sched.pollIntervalMin} min, ci-watch every ${Math.round(CI_WATCH_INTERVAL_MS / 1000)}s (autopilot ${isAutopilot() ? "on" : "off"})`
  );
  return sched;
}

async function safeTick() {
  try {
    await tick();
  } catch (err) {
    console.error("[scheduler] tick failed:", err.message);
    recordDecision("paused", null, `tick error: ${err.message}`);
  }
}

export function stop() {
  if (sched.timer) {
    clearInterval(sched.timer);
    sched.timer = null;
  }
  if (sched.ciTimer) {
    clearInterval(sched.ciTimer);
    sched.ciTimer = null;
  }
}
