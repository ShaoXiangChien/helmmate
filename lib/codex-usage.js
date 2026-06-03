// Codex usage probe. Codex sessions write `event_msg` / `token_count` events to
// ~/.codex/sessions/**/*.jsonl; those events include the rate-limit snapshot the
// Codex app already received from ChatGPT: primary/secondary used_percent,
// reset timestamps, plan type, and credits. This is local-only and credential
// free: no auth token is read and no network request is made.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");
const CACHE_TTL_MS = 15 * 1000;

let cache = { at: 0, value: null };

function findSessionFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) findSessionFiles(full, out);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const stat = fs.statSync(full);
        out.push({ path: full, mtimeMs: stat.mtimeMs });
      }
    } catch {
      /* skip unreadable entry */
    }
  }
  return out;
}

function resetTime(seconds) {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;
}

function parseWindow(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    pct: typeof raw.used_percent === "number" ? raw.used_percent : null,
    windowMinutes: typeof raw.window_minutes === "number" ? raw.window_minutes : null,
    resetTime: resetTime(raw.resets_at),
  };
}

function snapshotFromRecord(record, file) {
  const rateLimits = record.rate_limits || (record.payload && record.payload.rate_limits);
  if (!rateLimits || typeof rateLimits !== "object") return null;
  const ts = Date.parse(record.timestamp || record.created_at || "");
  return {
    asOf: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
    source: "codex-session-log",
    file,
    limitId: rateLimits.limit_id || null,
    limitName: rateLimits.limit_name || null,
    planType: rateLimits.plan_type || null,
    reachedType: rateLimits.rate_limit_reached_type || null,
    primary: parseWindow(rateLimits.primary),
    secondary: parseWindow(rateLimits.secondary),
    credits: rateLimits.credits || null,
  };
}

function readLatestSnapshot() {
  const files = findSessionFiles(SESSIONS_DIR)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 40);

  let best = null;
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file.path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.includes('"rate_limits"')) continue;
      try {
        const record = JSON.parse(line);
        const snap = snapshotFromRecord(record, file.path);
        const ts = snap && snap.asOf ? Date.parse(snap.asOf) : NaN;
        if (snap && Number.isFinite(ts) && (!best || ts > best.ts)) {
          best = { ts, snap };
        }
      } catch {
        /* skip malformed/partial lines */
      }
    }
  }
  return best ? best.snap : null;
}

export function getCodexUsage({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < CACHE_TTL_MS) return cache.value;
  const value = readLatestSnapshot();
  cache = { at: now, value };
  return value;
}
