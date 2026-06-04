// Maps a ticket to its autonomous-session ROLE and effective MODEL — the single
// source of truth shared by the launcher (which passes --agent / --model to the
// spawned `claude` session) and the scheduler (which gates expensive Opus spend).
//
// A "role" is a configured persona file. Its `model:` frontmatter can pin the model;
// the values in ROLES below come from helmmate.config.json. The
// launcher lets the frontmatter drive the model by default and only passes an
// explicit --model when a ticket pins an override (e.g. an Opus opt-up on an
// otherwise-Sonnet role). The scheduler uses effectiveModel()/isOpus() ONLY to
// decide gating; it never launches.
import fs from "node:fs";
import path from "node:path";
import { AGENTS_DIR, ROLE_BY_REPO, ROLE_CONFIG } from "./paths.js";
import { readAgentModel } from "./agents-config.js";

// role -> default model from helmmate.config.json.
export const ROLES = ROLE_CONFIG;

// The role for a ticket: an explicit, KNOWN ticket.role wins; else map by repo;
// else fall back to cross-repo as the safe generalist.
export function resolveRole(ticket) {
  if (ticket && typeof ticket.role === "string" && ROLES[ticket.role]) return ticket.role;
  return (ticket && ROLE_BY_REPO[ticket.repo]) || "cross-repo";
}

// The effective model, resolved in priority order:
//   1. explicit per-ticket override (ticket.model) — e.g. an Opus opt-up,
//   2. the role persona file's `model:` frontmatter (source of
//      truth — editing it in the Agents tab flows here),
//   3. the hardcoded ROLES fallback (file missing/unparseable),
//   4. "sonnet".
export function effectiveModel(ticket) {
  if (ticket && typeof ticket.model === "string" && ticket.model) return ticket.model;
  const role = resolveRole(ticket);
  const fromFile = readAgentModel(role);
  if (fromFile) return fromFile;
  const r = ROLES[role];
  return r ? r.model : "sonnet";
}

// True when this ticket would run on Opus (role default or override) — used by
// the scheduler's stricter Opus budget gate.
export function isOpus(ticket) {
  return /opus/i.test(effectiveModel(ticket));
}

// --- Codex engine knobs ----------------------------------------------------
//
// When a ticket runs on Codex instead of Claude, a "role" can't carry a persona
// file (Codex has no --agent; the persona is injected as a prompt preamble — see
// engine.js). A role maps to BOTH a default Codex model and reasoning-effort tier.
// Per-ticket codex_model / codex_effort can still opt up/down explicitly.
export const CODEX_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2",
];

export const CODEX_EFFORTS = ["low", "medium", "high", "xhigh"];

export const CODEX_MODEL_BY_ROLE = {
  "ios-engineer": "gpt-5.4-mini",
  "backend-engineer": "gpt-5.4-mini",
  "cross-repo": "gpt-5.3-codex",
  "architect": "gpt-5.5",
};

export const CODEX_EFFORT_BY_ROLE = {
  "ios-engineer": "medium",
  "backend-engineer": "medium",
  "cross-repo": "high",
  "architect": "high",
};

// The Codex reasoning effort for a ticket: explicit ticket.codex_effort wins;
// else the role's tier; else "medium".
export function codexEffort(ticket) {
  if (
    ticket &&
    typeof ticket.codex_effort === "string" &&
    CODEX_EFFORTS.includes(ticket.codex_effort)
  ) {
    return ticket.codex_effort;
  }
  const role = resolveRole(ticket);
  return CODEX_EFFORT_BY_ROLE[role] || "medium";
}

// The Codex model for a ticket: explicit ticket.codex_model override first;
// otherwise the role's cost-aware default. This is intentionally passed with
// `-m` so Codex does not silently fall back to ~/.codex/config.toml.
export function codexModel(ticket) {
  if (
    ticket &&
    typeof ticket.codex_model === "string" &&
    CODEX_MODELS.includes(ticket.codex_model)
  ) {
    return ticket.codex_model;
  }
  const role = resolveRole(ticket);
  return CODEX_MODEL_BY_ROLE[role] || "gpt-5.4-mini";
}

export function agentFilePath(role) {
  return path.join(AGENTS_DIR, `${role}.md`);
}

// Does the on-disk persona file exist? The launcher falls back to a plain
// --model run when it doesn't, so a missing/renamed role never hard-fails a
// session.
export function agentFileExists(role) {
  try {
    return fs.statSync(agentFilePath(role)).isFile();
  } catch {
    return false;
  }
}
