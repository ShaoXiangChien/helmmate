// Persistent run ledger for detached ticket-working processes.
import fs from "node:fs";
import { RUNS_FILE } from "./paths.js";

// --- Token accounting -------------------------------------------------------
//
// Detached sessions are launched with `--output-format stream-json`, so each
// log line is a JSON event. We sum token usage across the run and, when the
// final {type:"result"} event is present, prefer its cumulative usage and
// total_cost_usd (the CLI's own authoritative numbers) over our line-by-line
// sum. Logs may be partial, plain-text (older runs), or not stream-json at
// all — every parse step is defensive and never throws.

const EMPTY_TOKENS = Object.freeze({
  input: 0,
  output: 0,
  cache_create: 0,
  cache_read: 0,
  // Single headline metric used for the learned cost model: input + output +
  // cache-creation tokens (excludes cheap cache reads).
  tokens_metric: 0,
});

// Pull a usage object out of an event regardless of nesting shape. Stream-json
// assistant events carry usage at event.message.usage; result events at
// event.usage. Be liberal about either.
function usageFromEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (event.usage && typeof event.usage === "object") return event.usage;
  if (event.message && typeof event.message.usage === "object") {
    return event.message.usage;
  }
  return null;
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function tokensFromUsage(usage) {
  if (!usage || typeof usage !== "object") return { ...EMPTY_TOKENS };
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheCreate = num(usage.cache_creation_input_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  return {
    input,
    output,
    cache_create: cacheCreate,
    cache_read: cacheRead,
    tokens_metric: input + output + cacheCreate,
  };
}

function addTokens(a, b) {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cache_create: a.cache_create + b.cache_create,
    cache_read: a.cache_read + b.cache_read,
    tokens_metric: a.tokens_metric + b.tokens_metric,
  };
}

// Codex `--json` emits per-turn usage on `turn.completed` events with DIFFERENT
// field names than Claude: input_tokens / output_tokens (same) but
// cached_input_tokens (vs Claude's cache_read_input_tokens) and no
// cache_creation_input_tokens. cached is a SUBSET of input, so tokens_metric is
// just input + output (no double count). Codex reports no dollar cost.
function tokensFromCodexUsage(usage) {
  if (!usage || typeof usage !== "object") return { ...EMPTY_TOKENS };
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheRead = num(usage.cached_input_tokens);
  return {
    input,
    output,
    cache_create: 0,
    cache_read: cacheRead,
    tokens_metric: input + output,
  };
}

// Parse a Codex JSONL log: sum `usage` across every `turn.completed` event
// (each turn's input is genuinely re-billed, so summing reflects real spend).
// costUSD is always null (subscription billing — no per-token dollar figure).
function parseCodexLogTokens(text) {
  let summed = { ...EMPTY_TOKENS };
  let sawAny = false;
  let limitHit = false;
  let limitMarker = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line[0] !== "{") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "turn.completed" && event.usage) {
      sawAny = true;
      summed = addTokens(summed, tokensFromCodexUsage(event.usage));
    }
    if (!limitHit) {
      const errText = limitTextFromEvent(event);
      if (errText) {
        limitHit = true;
        limitMarker = errText.slice(0, 200);
      }
    }
  }

  if (sawAny) return { tokens: summed, costUSD: null, source: "codex", limitHit, limitMarker };
  return { tokens: { ...EMPTY_TOKENS }, costUSD: null, source: "none", limitHit, limitMarker };
}

// Parse a stream-json log file and return { tokens, costUSD, source }.
// - tokens: aggregate token shape (see EMPTY_TOKENS).
// - costUSD: number or null (only set when the result event reports it).
// - source: "result" when a final result event supplied the totals, "summed"
//   when we fell back to the per-message sum, or "none" when nothing parsed.
export function parseLogTokens(logPath, engine = "claude", { startOffset = 0 } = {}) {
  let text;
  try {
    if (!logPath || !fs.existsSync(logPath)) {
      return { tokens: { ...EMPTY_TOKENS }, costUSD: null, source: "none" };
    }
    const bytes = fs.readFileSync(logPath);
    text =
      startOffset > 0 && startOffset < bytes.length
        ? bytes.subarray(startOffset).toString("utf8")
        : bytes.toString("utf8");
  } catch (err) {
    console.error("[runs] failed to read log for tokens:", err.message);
    return { tokens: { ...EMPTY_TOKENS }, costUSD: null, source: "none" };
  }

  // Codex logs are a different JSONL dialect — parse them separately.
  if (engine === "codex") return parseCodexLogTokens(text);

  let summed = { ...EMPTY_TOKENS };
  let resultTokens = null;
  let costUSD = null;
  let sawAny = false;
  let limitHit = false;
  let limitMarker = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line[0] !== "{") continue; // skip plain-text/log-prefix lines
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // partial or non-JSON line
    }

    const usage = usageFromEvent(event);
    if (usage) {
      sawAny = true;
      const t = tokensFromUsage(usage);
      if (event.type === "result") {
        // Result event carries cumulative usage — trust it over the sum.
        resultTokens = t;
      } else {
        summed = addTokens(summed, t);
      }
    }

    if (event.type === "result") {
      const cost = num(event.total_cost_usd);
      if (cost > 0) costUSD = cost;
    }

    // Usage-limit detection — SCOPED to the CLI's own error/result events only,
    // never assistant text (a ticket might mention "rate limiting" in normal output;
    // "rate limit" in normal output; that must NOT trip the breaker).
    if (!limitHit) {
      const errText = limitTextFromEvent(event);
      if (errText) {
        limitHit = true;
        limitMarker = errText.slice(0, 200);
      }
    }
  }

  if (resultTokens) {
    return { tokens: resultTokens, costUSD, source: "result", limitHit, limitMarker };
  }
  if (sawAny) {
    return { tokens: summed, costUSD, source: "summed", limitHit, limitMarker };
  }
  return { tokens: { ...EMPTY_TOKENS }, costUSD: null, source: "none", limitHit, limitMarker };
}

// Patterns that indicate the subscription/API usage limit was hit. Matched ONLY
// against CLI result/error event text (see parseLogTokens), never assistant
// content. Kept specific to avoid false positives.
const LIMIT_RE =
  /usage limit reached|usage limit|session limit|rate limit reached|rate[_ ]?limit_error|429|too many requests|quota (?:exceeded|reached)|limit (?:will )?reset|resets? at/i;

function limitTextFromEvent(event) {
  if (!event || typeof event !== "object") return null;
  const type = event.type;
  const isCliLimitEvent =
    type === "result" ||
    type === "error" ||
    type === "turn.failed" ||
    type === "rate_limit_event";
  if (!isCliLimitEvent) return null;

  if (event.api_error_status === 429) {
    const text = errorTextFromEvent(event);
    return text || "api_error_status 429";
  }

  if (type === "rate_limit_event") {
    const info = event.rate_limit_info;
    const rejected = info && info.status === "rejected";
    const text = [
      "rate_limit_event",
      info && typeof info.status === "string" ? info.status : null,
      info && typeof info.overageStatus === "string" ? info.overageStatus : null,
      info && typeof info.rateLimitType === "string" ? info.rateLimitType : null,
    ]
      .filter(Boolean)
      .join(" ");
    return rejected || LIMIT_RE.test(text) ? text : null;
  }

  const errText = errorTextFromEvent(event);
  return errText && LIMIT_RE.test(errText) ? errText : null;
}

// Pull a human-readable error string out of a result/error event, regardless of
// shape: { is_error, result }, { error: {message} | "..." }, { message }.
function errorTextFromEvent(event) {
  if (!event || typeof event !== "object") return null;
  // Only treat result events as errors when they say so.
  if (event.type === "result" && !event.is_error) return null;
  const candidates = [];
  if (typeof event.result === "string") candidates.push(event.result);
  if (typeof event.error === "string") candidates.push(event.error);
  if (event.error && typeof event.error === "object" && typeof event.error.message === "string") {
    candidates.push(event.error.message);
  }
  if (event.api_error_status != null) candidates.push(String(event.api_error_status));
  if (typeof event.message === "string") candidates.push(event.message);
  if (typeof event.subtype === "string") candidates.push(event.subtype);
  return candidates.join(" ") || null;
}

function readLedger() {
  try {
    if (!fs.existsSync(RUNS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(RUNS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[runs] failed to read run ledger:", err.message);
    return [];
  }
}

function writeLedger(runs) {
  try {
    fs.writeFileSync(RUNS_FILE, JSON.stringify(runs, null, 2) + "\n");
  } catch (err) {
    console.error("[runs] failed to write run ledger:", err.message);
  }
}

function pidExists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function listRuns() {
  return readLedger();
}

// Full ledger, newest first. Alias of listRuns() ordered for ledger/UI use.
export function getRuns() {
  return [...readLedger()].reverse();
}

// Attach parsed token/cost accounting to a run record (mutates `run`).
// Safe to call repeatedly; recomputes from the current log contents.
function applyTokenAccounting(run) {
  if (!run || !run.log_path) return run;
  const { tokens, costUSD, source, limitHit, limitMarker } = parseLogTokens(run.log_path, run.engine, {
    startOffset: run.log_start_offset || 0,
  });
  run.tokens = tokens;
  run.tokens_metric = tokens.tokens_metric;
  run.cost_usd = costUSD;
  run.tokens_source = source;
  run.limit_hit = !!limitHit;
  if (limitHit) run.limit_marker = limitMarker;
  return run;
}

// Aggregate token + cost totals across all finished runs in the ledger.
// "Finished" = anything that is no longer running (exited/killed/lost/error).
export function finishedRunTotals() {
  const runs = readLedger();
  const totals = {
    runs: 0,
    tokens: { input: 0, output: 0, cache_create: 0, cache_read: 0, tokens_metric: 0 },
    cost_usd: 0,
    has_cost: false,
  };
  for (const run of runs) {
    if (run.status === "running") continue;
    totals.runs += 1;
    const t = run.tokens || EMPTY_TOKENS;
    totals.tokens.input += num(t.input);
    totals.tokens.output += num(t.output);
    totals.tokens.cache_create += num(t.cache_create);
    totals.tokens.cache_read += num(t.cache_read);
    totals.tokens.tokens_metric += num(t.tokens_metric);
    if (typeof run.cost_usd === "number" && Number.isFinite(run.cost_usd)) {
      totals.cost_usd += run.cost_usd;
      totals.has_cost = true;
    }
  }
  return totals;
}

export function createRun({
  ticketId,
  pid,
  logPath,
  logStartOffset = 0,
  branch = null,
  worktreePath = null,
  role = null,
  model = null,
  engine = null,
}) {
  const runs = readLedger();
  const run = {
    run_id: `${ticketId}-${Date.now()}`,
    ticket_id: ticketId,
    pid,
    status: "running",
    started_at: new Date().toISOString(),
    ended_at: null,
    exit_code: null,
    signal: null,
    log_path: logPath,
    log_start_offset: logStartOffset,
    branch,
    worktree_path: worktreePath,
    // Which role persona + model the launcher used (Phase 1). Older runs lack
    // these (null) and aggregate into an "unknown" bucket.
    role,
    model,
    // Which CLI worked the ticket ("claude" | "codex"). Drives which log parser
    // applyTokenAccounting uses. Older runs lack it → treated as claude.
    engine,
    pr_url: null,
  };
  runs.push(run);
  writeLedger(runs);
  return run;
}

// Aggregate finished-run token + cost totals grouped by role and by model, for
// the Agents tab's "spend by role / by model" view. A run missing role/model
// (pre-Phase-1) buckets under "unknown".
export function usageByRoleAndModel() {
  const runs = readLedger();
  const byRole = {};
  const byModel = {};
  const byEngine = {};
  const bump = (bucket, key, run) => {
    const k = key || "unknown";
    const b = (bucket[k] ||= { runs: 0, tokens_metric: 0, cost_usd: 0, has_cost: false });
    b.runs += 1;
    b.tokens_metric += num(run.tokens_metric ?? (run.tokens && run.tokens.tokens_metric));
    if (typeof run.cost_usd === "number" && Number.isFinite(run.cost_usd)) {
      b.cost_usd += run.cost_usd;
      b.has_cost = true;
    }
  };
  for (const run of runs) {
    if (run.status === "running") continue;
    bump(byRole, run.role, run);
    bump(byModel, run.model, run);
    // Pre-engine runs (no engine field) were all Claude.
    bump(byEngine, run.engine || "claude", run);
  }
  return { byRole, byModel, byEngine };
}

export function finishRun(pid, { status = "exited", code = null, signal = null } = {}) {
  const runs = readLedger();
  const run = [...runs].reverse().find((item) => item.pid === pid && item.status === "running");
  if (!run) return null;
  run.status = status;
  run.ended_at = new Date().toISOString();
  run.exit_code = code;
  run.signal = signal;
  applyTokenAccounting(run);
  writeLedger(runs);
  return run;
}

// Recompute token accounting for one run (by run_id) or all runs on demand,
// e.g. when a log was still being written at finish time. Returns the updated
// run(s). Persists the ledger.
export function recomputeRunTokens(runId = null) {
  const runs = readLedger();
  let changed = false;
  for (const run of runs) {
    if (runId && run.run_id !== runId) continue;
    applyTokenAccounting(run);
    changed = true;
  }
  if (changed) writeLedger(runs);
  return runId ? runs.find((r) => r.run_id === runId) || null : runs;
}

export function reconcileRuns() {
  const runs = readLedger();
  let changed = false;
  for (const run of runs) {
    if (run.status !== "running") continue;
    if (pidExists(run.pid)) continue;
    run.status = "lost";
    run.ended_at = new Date().toISOString();
    applyTokenAccounting(run);
    changed = true;
  }
  if (changed) writeLedger(runs);
  return runs.filter((run) => run.status === "running" && pidExists(run.pid));
}
