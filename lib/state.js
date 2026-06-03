// In-memory board state with disk persistence of the arm flag.
// running is intentionally in-memory only (pids are process-lifetime).
import fs from "node:fs";
import { STATE_FILE, DEFAULT_WIP_LIMIT, AGENT_ENGINE, ENGINES_CONFIG } from "./paths.js";

const ENGINES = ENGINES_CONFIG.allowed;

const state = {
  armed: false,
  // Autopilot: when true (and the board is armed), the scheduler is allowed to
  // dispatch eligible tickets on its own. Persisted like `armed`; defaults
  // false so the board never self-launches until a human explicitly opts in.
  autopilot: false,
  wipLimit: DEFAULT_WIP_LIMIT,
  // Board-wide default engine for tickets that don't pin their own (ticket.engine
  // wins). Persisted like `armed`.
  defaultEngine: AGENT_ENGINE,
  // Circuit breaker: trips when a dispatched session actually hits the usage /
  // rate limit. While tripped, the scheduler refuses to dispatch and autopilot
  // is forced off, until `until` (the block reset time) passes or a human clears
  // it. This is the REAL safety net — the usage % gauge is only an estimate.
  breaker: { tripped: false, until: null, reason: null, trippedAt: null },
  // Map<ticketId, { pid }>
  running: new Map(),
};

function persist() {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          armed: state.armed,
          autopilot: state.autopilot,
          wipLimit: state.wipLimit,
          defaultEngine: state.defaultEngine,
          breaker: state.breaker,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error("[state] failed to persist:", err.message);
  }
}

export function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      if (typeof raw.armed === "boolean") state.armed = raw.armed;
      if (typeof raw.autopilot === "boolean") state.autopilot = raw.autopilot;
      if (typeof raw.wipLimit === "number" && raw.wipLimit > 0) state.wipLimit = raw.wipLimit;
      if (ENGINES.includes(raw.defaultEngine)) state.defaultEngine = raw.defaultEngine;
      if (raw.breaker && typeof raw.breaker === "object") {
        state.breaker = {
          tripped: !!raw.breaker.tripped,
          until: raw.breaker.until || null,
          reason: raw.breaker.reason || null,
          trippedAt: raw.breaker.trippedAt || null,
        };
      }
    }
  } catch (err) {
    console.error("[state] failed to load, using defaults:", err.message);
  }
  return state;
}

export function getState() {
  return state;
}

export function isArmed() {
  return state.armed;
}

export function setArmed(armed) {
  state.armed = !!armed;
  persist();
  return state.armed;
}

export function isAutopilot() {
  return state.autopilot;
}

export function setAutopilot(on) {
  state.autopilot = !!on;
  persist();
  return state.autopilot;
}

export function getWipLimit() {
  return state.wipLimit;
}

// --- Default engine --------------------------------------------------------

export function getDefaultEngine() {
  return state.defaultEngine;
}

// Set the board-wide default engine. Ignores anything not in ENGINES; returns
// the effective value.
export function setDefaultEngine(engine) {
  if (ENGINES.includes(engine)) {
    state.defaultEngine = engine;
    persist();
  }
  return state.defaultEngine;
}

// --- Circuit breaker -------------------------------------------------------

export function getBreaker() {
  return { ...state.breaker };
}

// Trip the breaker: stop all auto-dispatch and force autopilot off. `until` is
// when it may auto-clear (the active block's reset time); null = manual-only.
export function tripBreaker({ until = null, reason = "usage limit hit" } = {}) {
  state.breaker = {
    tripped: true,
    until: until || null,
    reason,
    trippedAt: new Date().toISOString(),
  };
  state.autopilot = false; // hard stop — a human must consciously re-enable.
  persist();
  return { ...state.breaker };
}

export function clearBreaker() {
  state.breaker = { tripped: false, until: null, reason: null, trippedAt: null };
  persist();
  return { ...state.breaker };
}

// Auto-clear once the reset time has passed. Returns true if it cleared.
export function clearBreakerIfExpired() {
  const b = state.breaker;
  if (b.tripped && b.until && Date.now() >= Date.parse(b.until)) {
    clearBreaker();
    return true;
  }
  return false;
}

export function runningIds() {
  return [...state.running.keys()];
}

export function isRunning(id) {
  return state.running.has(id);
}

// The tracked pid for a running ticket, or null. Used by the manual-stop path
// to target the session's process group.
export function getRunningPid(id) {
  const entry = state.running.get(id);
  return entry ? entry.pid : null;
}

export function addRunning(id, pid) {
  state.running.set(id, { pid });
}

export function removeRunning(id) {
  state.running.delete(id);
}

// Snapshot for the API.
export function publicState() {
  return {
    armed: state.armed,
    autopilot: state.autopilot,
    wipLimit: state.wipLimit,
    defaultEngine: state.defaultEngine,
    running: runningIds(),
    breaker: { ...state.breaker },
  };
}
