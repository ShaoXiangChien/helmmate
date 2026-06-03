// Claude usage probe. Scans ~/.claude/projects/**/*.jsonl, reconstructs the
// active 5-hour rolling "block" (ccusage-style) and a trailing 7-day rollup,
// and reports token sums against a configurable budget.
//
// Pure Node (fs/os/path). No deps. Robust to malformed lines (skipped).
// Results are cached for ~30s to avoid re-scanning on every API call.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOfficialSnapshot, maybeRefresh } from "./official-usage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); // .../dev-board/lib

const BOARD_DIR = path.resolve(__dirname, "..");
const CONFIG_FILE = path.join(BOARD_DIR, "usage.config.json");
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

const HOUR_MS = 60 * 60 * 1000;
const BLOCK_HOURS = 5;
const BLOCK_MS = BLOCK_HOURS * HOUR_MS;
const WEEK_MS = 7 * 24 * HOUR_MS;
const CACHE_TTL_MS = 30 * 1000;
// Recent window used for the burn-rate slope, in minutes.
const BURN_WINDOW_MIN = 60;

const DEFAULT_CONFIG = {
  block_token_budget: 88000,
  weekly_token_budget: 880000,
  token_metric: "io_cache_create",
  day_window_hours: [8, 24],
  day_cap_pct: 0.8,
  night_cap_pct: 1.0,
  poll_interval_min: 20,
  autopilot: false,
  calibrate: true,
};

const VALID_METRICS = new Set(["total", "io", "io_cache_create", "weighted"]);

// --- config -----------------------------------------------------------------

// Re-read on each call so edits take effect; fall back to defaults if the file
// is missing or invalid.
function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
    const cfg = { ...DEFAULT_CONFIG, ...raw };
    if (!VALID_METRICS.has(cfg.token_metric)) cfg.token_metric = DEFAULT_CONFIG.token_metric;
    return cfg;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// --- transcript scan ---------------------------------------------------------

// Recursively collect every *.jsonl under ~/.claude/projects.
function findJsonlFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        findJsonlFiles(full, out);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push(full);
      }
    } catch {
      /* skip unreadable entry */
    }
  }
  return out;
}

function usageOf(record) {
  const u = record && record.message && record.message.usage;
  if (!u || typeof u !== "object") return null;
  const input = Number(u.input_tokens) || 0;
  const output = Number(u.output_tokens) || 0;
  const cacheCreate = Number(u.cache_creation_input_tokens) || 0;
  const cacheRead = Number(u.cache_read_input_tokens) || 0;
  if (input === 0 && output === 0 && cacheCreate === 0 && cacheRead === 0) return null;
  return { input, output, cacheCreate, cacheRead };
}

// One pass over disk: return entries [{ ts (ms), input, output, cacheCreate,
// cacheRead }], sorted ascending by timestamp. Malformed lines are skipped.
function collectEntries() {
  const files = findJsonlFiles(PROJECTS_DIR);
  const entries = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const u = usageOf(record);
      if (!u) continue;
      const tsRaw = record.timestamp;
      const ts = tsRaw ? Date.parse(tsRaw) : NaN;
      if (!Number.isFinite(ts)) continue;
      entries.push({ ts, ...u });
    }
  }
  entries.sort((a, b) => a.ts - b.ts);
  return entries;
}

// --- block math --------------------------------------------------------------

function emptySums() {
  return { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, count: 0 };
}

function addEntry(sums, e) {
  sums.input += e.input;
  sums.output += e.output;
  sums.cacheCreate += e.cacheCreate;
  sums.cacheRead += e.cacheRead;
  sums.count += 1;
}

// Derived metric views over a raw {input,output,cacheCreate,cacheRead} sum.
function metrics(sums) {
  const io = sums.input + sums.output;
  return {
    total: io + sums.cacheCreate + sums.cacheRead,
    io,
    io_cache_create: io + sums.cacheCreate,
    weighted: io + sums.cacheCreate + 0.1 * sums.cacheRead,
  };
}

function metricValue(sums, metric) {
  const m = metrics(sums);
  return m[metric] != null ? m[metric] : m.io_cache_create;
}

// Partition entries into ccusage-style 5-hour blocks. A block starts at the
// hour-floor of its first entry; an entry belongs to the current block while it
// is within 5h of the block start AND within 5h of the previous entry. A gap of
// more than 5h closes the block and starts a new one.
function buildBlocks(entries) {
  const blocks = [];
  let current = null;
  for (const e of entries) {
    if (current) {
      const withinWindow = e.ts < current.startTime + BLOCK_MS;
      const withinGap = e.ts < current.lastEntry + BLOCK_MS;
      if (withinWindow && withinGap) {
        addEntry(current.sums, e);
        current.lastEntry = e.ts;
        current.entries.push(e);
        continue;
      }
    }
    const startTime = Math.floor(e.ts / HOUR_MS) * HOUR_MS;
    current = {
      startTime,
      endTime: startTime + BLOCK_MS,
      firstEntry: e.ts,
      lastEntry: e.ts,
      sums: emptySums(),
      entries: [e],
    };
    addEntry(current.sums, e);
    blocks.push(current);
  }
  return blocks;
}

// The active block: its window contains now AND its last entry is within 5h.
function findActiveBlock(blocks, now) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    const windowLive = now >= b.startTime && now < b.endTime;
    const recent = now - b.lastEntry < BLOCK_MS;
    if (windowLive && recent) return b;
  }
  return null;
}

// Tokens accrued in the trailing BURN_WINDOW_MIN of the active block, used to
// estimate a per-minute burn rate.
function burnRate(block, now) {
  const cutoff = now - BURN_WINDOW_MIN * 60 * 1000;
  const recent = emptySums();
  let earliest = null;
  for (const e of block.entries) {
    if (e.ts >= cutoff) {
      addEntry(recent, e);
      if (earliest === null) earliest = e.ts;
    }
  }
  if (recent.count === 0 || earliest === null) return { tokensPerMin: 0, recent };
  const spanMin = Math.max((now - earliest) / 60000, 1);
  return { tokensPerMin: metricValue(recent, "io_cache_create") / spanMin, recent };
}

// --- cap (day vs night) ------------------------------------------------------

// Day-window hours cap usage at a lower fraction of the budget; nights allow
// the full budget. Hour read from local time.
function capForNow(cfg, now) {
  const hour = new Date(now).getHours();
  const [startH, endH] = Array.isArray(cfg.day_window_hours)
    ? cfg.day_window_hours
    : DEFAULT_CONFIG.day_window_hours;
  let isDay;
  if (startH <= endH) {
    isDay = hour >= startH && hour < endH;
  } else {
    // wraps past midnight
    isDay = hour >= startH || hour < endH;
  }
  return {
    isDay,
    capPct: isDay ? cfg.day_cap_pct : cfg.night_cap_pct,
  };
}

// --- public API --------------------------------------------------------------

let cache = { at: 0, value: null };

function compute() {
  const cfg = readConfig();
  const now = Date.now();
  const entries = collectEntries();
  const blocks = buildBlocks(entries);

  // Effective block budget — optionally calibrated against the largest
  // historical block sum (in the chosen metric) ever observed.
  let effectiveBlockBudget = cfg.block_token_budget;
  let peakBlock = 0;
  for (const b of blocks) {
    const v = metricValue(b.sums, cfg.token_metric);
    if (v > peakBlock) peakBlock = v;
  }
  if (cfg.calibrate) {
    effectiveBlockBudget = Math.max(cfg.block_token_budget, Math.round(peakBlock));
  }

  const active = findActiveBlock(blocks, now);
  const cap = capForNow(cfg, now);

  let block;
  if (active) {
    const m = metrics(active.sums);
    const chosen = metricValue(active.sums, cfg.token_metric);
    const pct = effectiveBlockBudget > 0 ? chosen / effectiveBlockBudget : 0;
    const minutesElapsed = Math.max((now - active.startTime) / 60000, 0);
    const minutesRemaining = Math.max((active.endTime - now) / 60000, 0);
    const { tokensPerMin } = burnRate(active, now);
    const projectedTokensAtReset = Math.round(chosen + tokensPerMin * minutesRemaining);
    const capTokens = Math.round(effectiveBlockBudget * cap.capPct);

    block = {
      active: true,
      startTime: new Date(active.startTime).toISOString(),
      resetTime: new Date(active.endTime).toISOString(),
      lastEntryTime: new Date(active.lastEntry).toISOString(),
      minutesElapsed: Math.round(minutesElapsed),
      minutesRemaining: Math.round(minutesRemaining),
      entries: active.sums.count,
      tokens: {
        total: Math.round(m.total),
        io: Math.round(m.io),
        io_cache_create: Math.round(m.io_cache_create),
        weighted: Math.round(m.weighted),
      },
      raw: {
        input: active.sums.input,
        output: active.sums.output,
        cache_creation: active.sums.cacheCreate,
        cache_read: active.sums.cacheRead,
      },
      metric: cfg.token_metric,
      metricTokens: Math.round(chosen),
      budget: cfg.block_token_budget,
      effectiveBudget: effectiveBlockBudget,
      calibrated: !!cfg.calibrate && effectiveBlockBudget > cfg.block_token_budget,
      pct,
      cap: { isDay: cap.isDay, capPct: cap.capPct, capTokens },
      overCap: chosen >= capTokens,
      burnTokensPerMin: Math.round(tokensPerMin),
      projectedTokensAtReset,
      projectedPct: effectiveBlockBudget > 0 ? projectedTokensAtReset / effectiveBlockBudget : 0,
    };
  } else {
    // No active block: report a fresh window keyed off now.
    const startTime = Math.floor(now / HOUR_MS) * HOUR_MS;
    const capTokens = Math.round(effectiveBlockBudget * cap.capPct);
    block = {
      active: false,
      startTime: new Date(startTime).toISOString(),
      resetTime: new Date(startTime + BLOCK_MS).toISOString(),
      lastEntryTime: null,
      minutesElapsed: 0,
      minutesRemaining: BLOCK_HOURS * 60,
      entries: 0,
      tokens: { total: 0, io: 0, io_cache_create: 0, weighted: 0 },
      raw: { input: 0, output: 0, cache_creation: 0, cache_read: 0 },
      metric: cfg.token_metric,
      metricTokens: 0,
      budget: cfg.block_token_budget,
      effectiveBudget: effectiveBlockBudget,
      calibrated: !!cfg.calibrate && effectiveBlockBudget > cfg.block_token_budget,
      pct: 0,
      cap: { isDay: cap.isDay, capPct: cap.capPct, capTokens },
      overCap: false,
      burnTokensPerMin: 0,
      projectedTokensAtReset: 0,
      projectedPct: 0,
    };
  }

  // Trailing 7-day rollup.
  const weekCutoff = now - WEEK_MS;
  const weekSums = emptySums();
  for (const e of entries) {
    if (e.ts >= weekCutoff) addEntry(weekSums, e);
  }
  const wm = metrics(weekSums);
  const weekChosen = metricValue(weekSums, cfg.token_metric);
  const weekly = {
    windowStart: new Date(weekCutoff).toISOString(),
    windowEnd: new Date(now).toISOString(),
    entries: weekSums.count,
    tokens: {
      total: Math.round(wm.total),
      io: Math.round(wm.io),
      io_cache_create: Math.round(wm.io_cache_create),
      weighted: Math.round(wm.weighted),
    },
    raw: {
      input: weekSums.input,
      output: weekSums.output,
      cache_creation: weekSums.cacheCreate,
      cache_read: weekSums.cacheRead,
    },
    metric: cfg.token_metric,
    metricTokens: Math.round(weekChosen),
    budget: cfg.weekly_token_budget,
    pct: cfg.weekly_token_budget > 0 ? weekChosen / cfg.weekly_token_budget : 0,
  };

  // --- official overlay ------------------------------------------------------
  // Prefer Anthropic's own rate-limit endpoint for the authoritative pct + reset
  // (real, not estimated). Kick a background refresh so the cache self-heals,
  // then overlay whatever snapshot is currently cached. Falls back silently to
  // the transcript estimate when the endpoint is unavailable.
  maybeRefresh();
  const off = getOfficialSnapshot();
  block.pctSource = "estimate";
  weekly.pctSource = "estimate";
  if (off && off.ok) {
    if (off.fiveHour && typeof off.fiveHour.utilization === "number") {
      block.pctSource = "official";
      block.active = true;
      block.pct = off.fiveHour.utilization / 100;
      if (off.fiveHour.resetsAt) {
        const resetMs = Date.parse(off.fiveHour.resetsAt);
        if (Number.isFinite(resetMs)) {
          block.resetTime = off.fiveHour.resetsAt;
          block.minutesRemaining = Math.max(Math.round((resetMs - now) / 60000), 0);
        }
      }
      // Recompute cap breach against the REAL pct. We don't synthesize a token
      // projection from the endpoint — the live % is the gate.
      block.overCap = block.pct >= block.cap.capPct;
      block.projectedPct = block.pct;
    }
    if (off.sevenDay && typeof off.sevenDay.utilization === "number") {
      weekly.pctSource = "official";
      weekly.pct = off.sevenDay.utilization / 100;
      if (off.sevenDay.resetsAt) weekly.resetTime = off.sevenDay.resetsAt;
    }
    block.official = {
      fiveHour: off.fiveHour,
      sevenDay: off.sevenDay,
      sevenDayOpus: off.sevenDayOpus,
      sevenDaySonnet: off.sevenDaySonnet,
      extraUsage: off.extraUsage,
      fetchedAt: off.fetchedAt,
    };
  } else if (off && !off.ok) {
    block.officialError = off.reason;
  }

  return {
    generatedAt: new Date(now).toISOString(),
    config: cfg,
    blocksSeen: blocks.length,
    peakBlockTokens: Math.round(peakBlock),
    officialSource: block.pctSource === "official",
    block,
    weekly,
  };
}

// getUsage() — cached for ~30s. Pass { force: true } to bypass the cache.
export function getUsage(opts = {}) {
  const now = Date.now();
  if (!opts.force && cache.value && now - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }
  let value;
  try {
    value = compute();
  } catch (err) {
    console.error("[usage] compute failed:", err.message);
    // Serve stale cache if we have it; otherwise a minimal error shape.
    if (cache.value) return cache.value;
    value = { generatedAt: new Date(now).toISOString(), error: err.message, block: null, weekly: null };
  }
  cache = { at: now, value };
  return value;
}

// getRawBlock() — debugging helper. Returns the active block's raw entries plus
// every block's summary, uncached.
export function getRawBlock() {
  const cfg = readConfig();
  const now = Date.now();
  const entries = collectEntries();
  const blocks = buildBlocks(entries);
  const active = findActiveBlock(blocks, now);
  return {
    now: new Date(now).toISOString(),
    metric: cfg.token_metric,
    totalEntries: entries.length,
    blocks: blocks.map((b) => ({
      startTime: new Date(b.startTime).toISOString(),
      endTime: new Date(b.endTime).toISOString(),
      lastEntry: new Date(b.lastEntry).toISOString(),
      entries: b.sums.count,
      tokens: metrics(b.sums),
      raw: {
        input: b.sums.input,
        output: b.sums.output,
        cache_creation: b.sums.cacheCreate,
        cache_read: b.sums.cacheRead,
      },
    })),
    activeBlock: active
      ? {
          startTime: new Date(active.startTime).toISOString(),
          endTime: new Date(active.endTime).toISOString(),
          entries: active.entries.map((e) => ({
            ts: new Date(e.ts).toISOString(),
            input: e.input,
            output: e.output,
            cache_creation: e.cacheCreate,
            cache_read: e.cacheRead,
          })),
        }
      : null,
  };
}
