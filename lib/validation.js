import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CODEX_BIN, REPO_KEYS, STATUSES, WORKSPACE_DIR } from "./paths.js";
import { resolveEngine } from "./engine.js";
import { CODEX_EFFORTS, CODEX_MODELS } from "./roles.js";

export const VALID_STATUSES = STATUSES;
export const VALID_REPOS = REPO_KEYS;
export const VALID_PRIORITIES = ["P0", "P1", "P2"];
export const VALID_SIZES = ["S", "M", "L"];
export const VALID_SOURCES = ["manual", "v1-plan", "open-loop"];

const REQUIRED_FIELDS = [
  "id",
  "title",
  "status",
  "priority",
  "repo",
  "depends_on",
  "description",
  "acceptance_criteria",
  "context_refs",
  "branch",
  "notes",
];

function issue(level, code, message) {
  return { level, code, message };
}

function commandExists(command) {
  if (String(command).includes("/")) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    cwd: WORKSPACE_DIR,
    stdio: "ignore",
  });
  return result.status === 0;
}

function looksLikePath(ref) {
  return (
    typeof ref === "string" &&
    !ref.startsWith("http://") &&
    !ref.startsWith("https://") &&
    !ref.includes("§") &&
    !ref.includes("(")
  );
}

function refPath(ref) {
  const clean = String(ref).split("#")[0].trim().split(/\s+/)[0];
  if (!clean) return null;
  return path.join(WORKSPACE_DIR, clean);
}

export function validateTicketShape(ticket) {
  const issues = [];
  if (!ticket || typeof ticket !== "object") {
    return [issue("error", "not_object", "ticket is not an object")];
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in ticket)) issues.push(issue("error", "missing_field", `missing ${field}`));
  }

  if (!VALID_STATUSES.includes(ticket.status)) {
    issues.push(issue("error", "bad_status", `unknown status: ${ticket.status}`));
  }
  if (!VALID_REPOS.includes(ticket.repo)) {
    issues.push(issue("error", "bad_repo", `unknown repo: ${ticket.repo}`));
  }
  if (!VALID_PRIORITIES.includes(ticket.priority)) {
    issues.push(issue("error", "bad_priority", `unknown priority: ${ticket.priority}`));
  }
  if (ticket.size != null && ticket.size !== "" && !VALID_SIZES.includes(ticket.size)) {
    issues.push(issue("error", "bad_size", `unknown size: ${ticket.size}`));
  }
  if (ticket.source != null && ticket.source !== "" && !VALID_SOURCES.includes(ticket.source)) {
    issues.push(issue("error", "bad_source", `unknown source: ${ticket.source}`));
  }
  if (!Array.isArray(ticket.depends_on)) {
    issues.push(issue("error", "bad_depends_on", "depends_on must be an array"));
  }
  if (!Array.isArray(ticket.acceptance_criteria)) {
    issues.push(issue("error", "bad_acceptance_criteria", "acceptance_criteria must be an array"));
  }
  if (!Array.isArray(ticket.context_refs)) {
    issues.push(issue("error", "bad_context_refs", "context_refs must be an array"));
  }
  if (!Array.isArray(ticket.notes)) {
    issues.push(issue("error", "bad_notes", "notes must be an array"));
  }
  if (ticket.codex_model != null && ticket.codex_model !== "" && !CODEX_MODELS.includes(ticket.codex_model)) {
    issues.push(issue("error", "bad_codex_model", `unknown codex_model: ${ticket.codex_model}`));
  }
  if (ticket.codex_effort != null && ticket.codex_effort !== "" && !CODEX_EFFORTS.includes(ticket.codex_effort)) {
    issues.push(issue("error", "bad_codex_effort", `unknown codex_effort: ${ticket.codex_effort}`));
  }

  return issues;
}

export function validateTicketSemantics(ticket, allById) {
  const issues = [];
  const deps = Array.isArray(ticket.depends_on) ? ticket.depends_on : [];

  for (const depId of deps) {
    if (!allById.has(depId)) {
      issues.push(issue("error", "missing_dependency", `dependency not found: ${depId}`));
    }
  }

  if (ticket.status === "human_review" && (!ticket.branch || !ticket.pr_url)) {
    issues.push(issue("warning", "review_missing_pr", "human_review ticket should have branch and pr_url"));
  }
  if (ticket.status === "done" && !ticket.pr_url) {
    issues.push(issue("warning", "done_missing_pr", "done ticket should have pr_url"));
  }

  const ac = Array.isArray(ticket.acceptance_criteria) ? ticket.acceptance_criteria : [];
  if (ticket.status === "backlog" && ac.length === 0) {
    issues.push(issue("warning", "missing_ac", "backlog ticket has no acceptance criteria"));
  }

  const refs = Array.isArray(ticket.context_refs) ? ticket.context_refs : [];
  for (const ref of refs) {
    if (!looksLikePath(ref)) continue;
    const resolved = refPath(ref);
    if (resolved && !fs.existsSync(resolved)) {
      issues.push(issue("warning", "missing_context_ref", `context ref not found: ${ref}`));
    }
  }

  return issues;
}

export function validateIndex(tickets, indexRows) {
  const ticketRows = tickets
    .map((t) => ({
      id: t.id,
      title: t.title,
      epic: t.epic,
      status: t.status,
      priority: t.priority,
      repo: t.repo,
      depends_on: Array.isArray(t.depends_on) ? t.depends_on : [],
      origin: t.origin ?? null,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const sortedIndex = [...indexRows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (JSON.stringify(ticketRows) === JSON.stringify(sortedIndex)) return [];
  return [issue("error", "index_drift", "_index.json does not match ticket files")];
}

export function validateDependencyGraph(tickets) {
  const issues = [];
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const visiting = new Set();
  const visited = new Set();

  function visit(id, stack) {
    if (visiting.has(id)) {
      issues.push(issue("error", "dependency_cycle", `dependency cycle: ${[...stack, id].join(" -> ")}`));
      return;
    }
    if (visited.has(id)) return;
    const ticket = byId.get(id);
    if (!ticket) return;
    visiting.add(id);
    for (const depId of ticket.depends_on || []) visit(depId, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  }

  for (const ticket of tickets) visit(ticket.id, []);
  return issues;
}

export function launchPreflight(ticket, options = {}) {
  const issues = [];
  const statusForRules = options.statusForRules || ticket.status;
  issues.push(...validateTicketShape(ticket));

  if (ticket.status === "blocked") {
    issues.push(issue("error", "ticket_blocked", "ticket is blocked"));
  }

  const ac = Array.isArray(ticket.acceptance_criteria) ? ticket.acceptance_criteria : [];
  if (statusForRules !== "triage" && ac.length === 0) {
    issues.push(issue("error", "missing_ac", "non-triage ticket needs acceptance criteria before launch"));
  } else if (statusForRules === "triage" && ac.length === 0) {
    issues.push(issue("warning", "missing_ac_triage", "triage ticket has no acceptance criteria"));
  }

  const engine = resolveEngine(ticket);
  if (engine === "codex") {
    if (!commandExists(CODEX_BIN)) {
      issues.push(issue("error", "missing_codex", `Codex CLI is not available at ${CODEX_BIN}`));
    }
  } else if (!commandExists("claude")) {
    issues.push(issue("error", "missing_claude", "Claude CLI is not available"));
  }
  if (!commandExists("gh")) {
    issues.push(issue("warning", "missing_gh", "gh CLI is not available; PR creation may fail"));
  }

  return issues;
}

export function isReadyTicket(ticket, allById, runningIds = []) {
  if (!["triage", "backlog"].includes(ticket.status)) return false;
  if (runningIds.includes(ticket.id)) return false;
  const deps = Array.isArray(ticket.depends_on) ? ticket.depends_on : [];
  if (!deps.every((depId) => allById.get(depId)?.status === "done")) return false;
  const preflightErrors = launchPreflight(ticket).filter((item) => item.level === "error");
  return preflightErrors.length === 0;
}
