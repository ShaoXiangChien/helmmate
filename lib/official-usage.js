// Official usage probe. Calls Anthropic's own rate-limit endpoint
//   GET https://api.anthropic.com/api/oauth/usage
// (the same source the `/usage` TUI and the `vusage` CLI read) with the local
// Claude Code OAuth token, and returns REAL utilization % + reset times for the
// 5-hour and 7-day windows. This is authoritative — strictly better than the
// transcript-scan estimate in usage.js, which stays as a fallback for when the
// endpoint is unreachable or the token is missing/expired.
//
// Credentials are read locally (file → macOS Keychain) and sent ONLY to
// api.anthropic.com over HTTPS. Nothing is uploaded anywhere else. Pure Node:
// fs + child_process(security) + global fetch. No third-party dep.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { BOARD_DIR } from "./paths.js";

const USAGE_API = "https://api.anthropic.com/api/oauth/usage";
const CREDENTIALS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const SNAPSHOT_CACHE_PATH = path.join(BOARD_DIR, ".official-usage-cache.json");

const TOKEN_TTL_MS = 5 * 60 * 1000; // re-read creds every ~5 min (token rotates)
const USAGE_TTL_MS = 60 * 1000; // a snapshot is "fresh" for ~60s — don't refetch within this
const STALE_MAX_MS = 15 * 60 * 1000; // keep serving the last GOOD snapshot up to 15 min on failure
const COOLDOWN_429_MS = 5 * 60 * 1000; // after a 429, stop hitting the endpoint for 5 min
const FETCH_TIMEOUT_MS = 10 * 1000;

// --- credential reading (file → keychain, neither prompts on this setup) -----

let tokenCache = { at: 0, token: null };

function readCredentialsFile() {
  try {
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
    const o = data.claudeAiOauth || data;
    if (!o || !o.accessToken) return null;
    if (o.expiresAt) {
      const exp = Date.parse(o.expiresAt);
      if (Number.isFinite(exp) && exp <= Date.now()) return null; // expired
    }
    return o.accessToken;
  } catch {
    return null;
  }
}

function readKeychainToken() {
  if (process.platform !== "darwin") return null;
  try {
    const out = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const data = JSON.parse(out.trim());
    const o = data.claudeAiOauth || data;
    if (!o || !o.accessToken) return null;
    if (o.expiresAt) {
      const exp = Date.parse(o.expiresAt);
      if (Number.isFinite(exp) && exp <= Date.now()) return null;
    }
    return o.accessToken;
  } catch {
    return null;
  }
}

function getToken() {
  const now = Date.now();
  if (tokenCache.token && now - tokenCache.at < TOKEN_TTL_MS) return tokenCache.token;
  const token = readCredentialsFile() || readKeychainToken();
  tokenCache = { at: now, token };
  return token;
}

// --- endpoint fetch + parse --------------------------------------------------

function parseTier(raw) {
  if (!raw || typeof raw !== "object") return null;
  const util =
    typeof raw.utilization === "number"
      ? raw.utilization
      : typeof raw.used_percentage === "number"
        ? raw.used_percentage
        : null;
  return {
    utilization: util, // 0..100, or null when the tier is inactive
    resetsAt: typeof raw.resets_at === "string" ? raw.resets_at : null,
  };
}

// Module cache. `good` is the last SUCCESSFUL snapshot (kept through failures so
// a transient 429/timeout doesn't flap the UI back to the estimate). `lastError`
// records the most recent failed attempt. `cooldownUntil` backs off after a 429
// — the usage endpoint is itself rate-limited, so we must poll it gently.
function readCachedGood() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_CACHE_PATH, "utf8"));
    return parsed && parsed.ok && parsed.fetchedAt ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedGood(snapshot) {
  try {
    fs.writeFileSync(SNAPSHOT_CACHE_PATH, JSON.stringify(snapshot, null, 2) + "\n");
  } catch {
    /* cache is best-effort */
  }
}

let good = readCachedGood(); // { ok:true, fiveHour, sevenDay, ..., fetchedAt }
let lastError = null; // { ok:false, reason, fetchedAt }
let lastAttemptAt = 0;
let cooldownUntil = 0;
let inflight = null;

async function doFetch() {
  lastAttemptAt = Date.now();
  const token = getToken();
  if (!token) {
    lastError = { ok: false, reason: "no Claude Code OAuth token (file/keychain)", fetchedAt: new Date().toISOString() };
    return lastError;
  }
  try {
    const res = await fetch(USAGE_API, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (res.status === 401) tokenCache = { at: 0, token: null }; // token rotated — re-read next time
      if (res.status === 429) cooldownUntil = Date.now() + COOLDOWN_429_MS; // back off the endpoint
      lastError = { ok: false, reason: `usage API HTTP ${res.status}`, fetchedAt: new Date().toISOString() };
      return lastError;
    }
    const data = await res.json();
    const eu = data.extra_usage;
    good = {
      ok: true,
      fiveHour: parseTier(data.five_hour),
      sevenDay: parseTier(data.seven_day),
      sevenDayOpus: parseTier(data.seven_day_opus),
      sevenDaySonnet: parseTier(data.seven_day_sonnet),
      extraUsage: eu
        ? {
            isEnabled: eu.is_enabled ?? false,
            // RAW field from the API — `used_credits`, unit unverified. NOT a
            // confirmed dollar charge (vusage reports pay-as-you-go spend as
            // $0.00; the API exposes no `spend` field). Surface it neutrally.
            usedCredits: typeof eu.used_credits === "number" ? eu.used_credits : null,
            monthlyLimit: typeof eu.monthly_limit === "number" ? eu.monthly_limit : null,
            utilization: typeof eu.utilization === "number" ? eu.utilization : null,
            currency: eu.currency || null,
            disabledReason: eu.disabled_reason || null,
          }
        : null,
      fetchedAt: new Date().toISOString(),
    };
    writeCachedGood(good);
    lastError = null;
    return good;
  } catch (err) {
    lastError = { ok: false, reason: err && err.message ? err.message : "fetch failed", fetchedAt: new Date().toISOString() };
    return lastError;
  }
}

export async function fetchOfficialUsage() {
  return doFetch();
}

// Sync accessor for compute(). Returns the last GOOD snapshot while it's still
// within STALE_MAX_MS (marked .stale when past the fresh TTL), so a transient
// endpoint failure keeps showing real data instead of falling back to the
// estimate. Only when there's no usable good snapshot does it return the error.
export function getOfficialSnapshot() {
  if (good && good.fetchedAt) {
    const age = Date.now() - Date.parse(good.fetchedAt);
    if (age < STALE_MAX_MS) {
      return age < USAGE_TTL_MS ? good : { ...good, stale: true, staleReason: lastError ? lastError.reason : null };
    }
  }
  return lastError; // null until the first attempt resolves
}

function shouldSkipFetch() {
  if (inflight) return true;
  if (Date.now() < cooldownUntil) return true; // 429 backoff
  const fresh = good && good.fetchedAt && Date.now() - Date.parse(good.fetchedAt) < USAGE_TTL_MS;
  return fresh;
}

// Fire-and-forget refresh if not fresh / not cooling down / not already running.
// Lets sync callers (compute()) self-heal without blocking or hammering. Never throws.
export function maybeRefresh() {
  if (shouldSkipFetch()) return;
  inflight = doFetch().finally(() => {
    inflight = null;
  });
}

// Await a refresh, but respect the same gentleness gates: if the snapshot is
// fresh or we're in a 429 cooldown, return the cached snapshot WITHOUT a network
// call. Coalesces concurrent refreshes. Never throws.
export async function refreshOfficialUsage() {
  if (shouldSkipFetch()) {
    if (inflight) await inflight;
    return getOfficialSnapshot();
  }
  inflight = doFetch().finally(() => {
    inflight = null;
  });
  await inflight;
  return getOfficialSnapshot();
}
