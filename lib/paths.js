// Shared configuration and filesystem paths.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); // .../helmmate/lib

export const BOARD_DIR = path.resolve(__dirname, "..");

const DEFAULT_CONFIG = {
  activeProject: "",
  workspaceDir: ".",
  ticketsDir: "tickets",
  ticketIdPrefix: "DB",
  defaultPort: 4317,
  host: "127.0.0.1",
  repos: {
    workspace: { path: ".", baseBranch: "main", worktree: false, role: "cross-repo" },
  },
  statuses: ["triage", "backlog", "queued", "in_progress", "blocked", "human_review", "done"],
  agentDir: ".agents",
  memoryQueueDir: "memory/sync-queue",
  workPrompt: "scripts/work-ticket-prompt.md",
  fixCiPrompt: "scripts/fix-ci-prompt.md",
  fixConflictPrompt: "scripts/fix-conflict-prompt.md",
  roles: {
    "ios-engineer": { model: "sonnet" },
    "backend-engineer": { model: "sonnet" },
    "cross-repo": { model: "sonnet" },
    architect: { model: "opus" },
  },
  roleByRepo: {
    workspace: "cross-repo",
  },
  engines: {
    default: "claude",
    allowed: ["claude", "codex", "opencode"],
  },
  defaultWipLimit: 2,
  agentModel: "sonnet",
};

function findConfigPath() {
  if (process.env.HELMMATE_CONFIG) return path.resolve(process.env.HELMMATE_CONFIG);
  const candidates = [
    path.resolve(process.cwd(), "helmmate.config.json"),
    path.join(BOARD_DIR, "helmmate.config.json"),
    path.resolve(BOARD_DIR, "..", "helmmate.config.json"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[1];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (fs.existsSync(file)) {
      console.error(`[config] failed to read ${file}:`, err.message);
    }
    return {};
  }
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueStrings(value, fallback) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return [...new Set(source.map(String).filter(Boolean))];
}

const KNOWN_ENGINES = new Set(["claude", "codex", "opencode"]);

function knownEngines(value, fallback = DEFAULT_CONFIG.engines.allowed) {
  const normalized = uniqueStrings(value, fallback).filter((engine) => KNOWN_ENGINES.has(engine));
  return normalized.length ? normalized : uniqueStrings(fallback, DEFAULT_CONFIG.engines.allowed).filter((engine) => KNOWN_ENGINES.has(engine));
}

function resolveFrom(base, value) {
  const raw = String(value || "");
  if (!raw) return base;
  return path.isAbsolute(raw) ? raw : path.resolve(base, raw);
}

export const CONFIG_PATH = findConfigPath();
export const CONFIG_DIR = path.dirname(CONFIG_PATH);

const rawConfig = readJson(CONFIG_PATH);
const rawProjects = object(rawConfig.projects);
const requestedProjectId =
  process.env.HELMMATE_PROJECT ||
  (typeof rawConfig.activeProject === "string" && rawConfig.activeProject) ||
  "";
const activeProjectId =
  (requestedProjectId && rawProjects[requestedProjectId] ? requestedProjectId : "") ||
  Object.keys(rawProjects)[0] ||
  "";
const projectConfigured = !!(activeProjectId && rawProjects[activeProjectId]);
const activeProjectConfig = object(rawProjects[activeProjectId]);
const merged = {
  ...DEFAULT_CONFIG,
  ...object(rawConfig),
  ...activeProjectConfig,
  activeProject: activeProjectId,
  projects: rawProjects,
  repos: { ...DEFAULT_CONFIG.repos, ...object(rawConfig.repos), ...object(activeProjectConfig.repos) },
  roles: { ...DEFAULT_CONFIG.roles, ...object(rawConfig.roles), ...object(activeProjectConfig.roles) },
  roleByRepo: { ...DEFAULT_CONFIG.roleByRepo, ...object(rawConfig.roleByRepo), ...object(activeProjectConfig.roleByRepo) },
  engines: { ...DEFAULT_CONFIG.engines, ...object(rawConfig.engines), ...object(activeProjectConfig.engines) },
};

if (process.env.HELMMATE_WORKSPACE_DIR) merged.workspaceDir = process.env.HELMMATE_WORKSPACE_DIR;
if (process.env.HELMMATE_TICKETS_DIR) merged.ticketsDir = process.env.HELMMATE_TICKETS_DIR;
if (process.env.HELMMATE_TICKET_ID_PREFIX) merged.ticketIdPrefix = process.env.HELMMATE_TICKET_ID_PREFIX;
if (process.env.HELMMATE_AGENT_DIR) merged.agentDir = process.env.HELMMATE_AGENT_DIR;
if (process.env.HELMMATE_MEMORY_QUEUE_DIR) merged.memoryQueueDir = process.env.HELMMATE_MEMORY_QUEUE_DIR;
if (process.env.HELMMATE_WORK_PROMPT) merged.workPrompt = process.env.HELMMATE_WORK_PROMPT;
if (process.env.HELMMATE_FIX_CI_PROMPT) merged.fixCiPrompt = process.env.HELMMATE_FIX_CI_PROMPT;
if (process.env.HELMMATE_FIX_CONFLICT_PROMPT) merged.fixConflictPrompt = process.env.HELMMATE_FIX_CONFLICT_PROMPT;
if (process.env.HELMMATE_HOST) merged.host = process.env.HELMMATE_HOST;
if (process.env.HELMMATE_PORT) merged.defaultPort = Number(process.env.HELMMATE_PORT);
if (process.env.HELMMATE_WIP_LIMIT) merged.defaultWipLimit = Number(process.env.HELMMATE_WIP_LIMIT);
if (process.env.HELMMATE_AGENT_MODEL) merged.agentModel = process.env.HELMMATE_AGENT_MODEL;
if (process.env.HELMMATE_AGENT_ENGINE) merged.engines.default = process.env.HELMMATE_AGENT_ENGINE;
if (process.env.HELMMATE_ENGINES) {
  merged.engines.allowed = process.env.HELMMATE_ENGINES.split(",").map((item) => item.trim()).filter(Boolean);
}

export const WORKSPACE_DIR = resolveFrom(CONFIG_DIR, merged.workspaceDir);
export const TICKETS_DIR = resolveFrom(WORKSPACE_DIR, merged.ticketsDir);
export const TICKETS_INDEX = path.join(TICKETS_DIR, "_index.json");
export const LOGS_DIR = path.join(BOARD_DIR, "logs");
export const RUNS_FILE = path.join(BOARD_DIR, ".runs.json");
export const STATE_FILE = path.join(BOARD_DIR, ".state.json");
export const PUBLIC_DIR = fs.existsSync(path.join(BOARD_DIR, "dist"))
  ? path.join(BOARD_DIR, "dist")
  : path.join(BOARD_DIR, "public");
export const SCRIPTS_PROMPT = resolveFrom(WORKSPACE_DIR, merged.workPrompt);
export const FIX_CI_PROMPT = resolveFrom(WORKSPACE_DIR, merged.fixCiPrompt);
export const FIX_CONFLICT_PROMPT = resolveFrom(WORKSPACE_DIR, merged.fixConflictPrompt);
export const AGENTS_DIR = resolveFrom(WORKSPACE_DIR, merged.agentDir);
export const MEMORY_QUEUE_DIR = resolveFrom(WORKSPACE_DIR, merged.memoryQueueDir);

export const HOST = String(merged.host || "127.0.0.1");
export const PORT = Number.isFinite(Number(merged.defaultPort)) ? Number(merged.defaultPort) : 4317;
export const DEFAULT_WIP_LIMIT =
  Number.isFinite(Number(merged.defaultWipLimit)) && Number(merged.defaultWipLimit) > 0
    ? Number(merged.defaultWipLimit)
    : 2;
export const TICKET_ID_PREFIX = String(merged.ticketIdPrefix || "DB");
export const STATUSES = uniqueStrings(merged.statuses, DEFAULT_CONFIG.statuses);

function normalizeRepos(repos) {
  const out = {};
  for (const [key, value] of Object.entries(object(repos))) {
    const repo = object(value);
    out[key] = {
      path: resolveFrom(WORKSPACE_DIR, repo.path || key),
      baseBranch: String(repo.baseBranch || "main"),
      worktree: !!repo.worktree,
      role: typeof repo.role === "string" && repo.role ? repo.role : null,
    };
  }
  return out;
}

export const REPOS = normalizeRepos(merged.repos);
export const REPO_KEYS = Object.keys(REPOS);
export const ROLE_BY_REPO = {
  ...Object.fromEntries(Object.entries(REPOS).filter(([, repo]) => repo.role).map(([key, repo]) => [key, repo.role])),
  ...merged.roleByRepo,
};
export const ROLE_CONFIG = merged.roles;
export const ENGINES_CONFIG = {
  default: String(merged.engines.default || "claude"),
  allowed: knownEngines(merged.engines.allowed),
};
export const TICKETS_REF = path.relative(WORKSPACE_DIR, TICKETS_DIR) || ".";
export const WORK_PROMPT_REF = path.relative(WORKSPACE_DIR, SCRIPTS_PROMPT) || SCRIPTS_PROMPT;
export const FIX_CI_PROMPT_REF = path.relative(WORKSPACE_DIR, FIX_CI_PROMPT) || FIX_CI_PROMPT;
export const FIX_CONFLICT_PROMPT_REF = path.relative(WORKSPACE_DIR, FIX_CONFLICT_PROMPT) || FIX_CONFLICT_PROMPT;

export const CONFIG = Object.freeze({
  ...merged,
  configPath: CONFIG_PATH,
  activeProject: activeProjectId,
  projectConfigured,
  workspaceDir: WORKSPACE_DIR,
  ticketsDir: TICKETS_DIR,
  agentDir: AGENTS_DIR,
  memoryQueueDir: MEMORY_QUEUE_DIR,
  repos: REPOS,
  statuses: STATUSES,
  ticketIdPrefix: TICKET_ID_PREFIX,
  engines: ENGINES_CONFIG,
});

// Model for autonomous ticket + fix sessions when no role-specific model exists.
export const AGENT_MODEL = String(merged.agentModel || "sonnet");

// --- Engine (which CLI works a ticket) -------------------------------------
const CODEX_APP_BIN = "/Applications/Codex.app/Contents/Resources/codex";
export const CODEX_BIN =
  process.env.HELMMATE_CODEX_BIN || (fs.existsSync(CODEX_APP_BIN) ? CODEX_APP_BIN : "codex");
export const OPENCODE_BIN = process.env.HELMMATE_OPENCODE_BIN || "opencode";

// Global default engine when board state doesn't pin one.
export const AGENT_ENGINE = ENGINES_CONFIG.allowed.includes(ENGINES_CONFIG.default)
  ? ENGINES_CONFIG.default
  : ENGINES_CONFIG.allowed[0] || "claude";
