import fs from "node:fs";
import path from "node:path";
import { CONFIG, CONFIG_PATH } from "./paths.js";

const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const PROJECT_FIELDS = [
  "name",
  "workspaceDir",
  "ticketsDir",
  "ticketIdPrefix",
  "repos",
  "statuses",
  "agentDir",
  "memoryQueueDir",
  "workPrompt",
  "fixCiPrompt",
  "fixConflictPrompt",
  "roles",
  "roleByRepo",
  "engines",
  "defaultWipLimit",
  "agentModel",
];

export function isValidProjectId(id) {
  return typeof id === "string" && PROJECT_ID_RE.test(id) && !id.includes("..");
}

function readRawConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeRawConfig(raw) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + "\n");
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compactProject(input = {}) {
  const out = {};
  for (const field of PROJECT_FIELDS) {
    if (input[field] !== undefined) out[field] = input[field];
  }
  return out;
}

function currentProjectSnapshot() {
  return compactProject({
    name: "Default",
    workspaceDir: CONFIG.workspaceDir,
    ticketsDir: CONFIG.ticketsDir,
    ticketIdPrefix: CONFIG.ticketIdPrefix,
    repos: Object.fromEntries(
      Object.entries(CONFIG.repos || {}).map(([key, repo]) => [
        key,
        {
          path: repo.path,
          baseBranch: repo.baseBranch || "main",
          worktree: !!repo.worktree,
          role: repo.role || undefined,
        },
      ])
    ),
    statuses: CONFIG.statuses,
    agentDir: CONFIG.agentDir,
    memoryQueueDir: CONFIG.memoryQueueDir,
    workPrompt: CONFIG.workPrompt,
    fixCiPrompt: CONFIG.fixCiPrompt,
    fixConflictPrompt: CONFIG.fixConflictPrompt,
    roles: CONFIG.roles,
    roleByRepo: CONFIG.roleByRepo,
    engines: CONFIG.engines,
    defaultWipLimit: CONFIG.defaultWipLimit,
    agentModel: CONFIG.agentModel,
  });
}

function ensureRegistry(raw) {
  const projects = object(raw.projects);
  const activeProject =
    (typeof raw.activeProject === "string" && raw.activeProject) ||
    Object.keys(projects)[0] ||
    CONFIG.activeProject ||
    "default";

  if (!projects[activeProject]) {
    projects[activeProject] = currentProjectSnapshot();
  }

  raw.projects = projects;
  raw.activeProject = activeProject;
  return raw;
}

export function listProjects() {
  const raw = ensureRegistry(readRawConfig());
  return {
    configPath: CONFIG_PATH,
    activeProject: raw.activeProject,
    runtimeActiveProject: CONFIG.activeProject,
    requiresRestartToSwitch: raw.activeProject !== CONFIG.activeProject,
    projects: raw.projects,
  };
}

export function saveProject(id, project) {
  if (!isValidProjectId(id)) return { ok: false, error: "invalid project id" };
  const raw = ensureRegistry(readRawConfig());
  raw.projects[id] = compactProject(project);
  if (!raw.activeProject) raw.activeProject = id;
  writeRawConfig(raw);
  return { ok: true, ...listProjects() };
}

export function setActiveProject(id) {
  if (!isValidProjectId(id)) return { ok: false, error: "invalid project id" };
  const raw = ensureRegistry(readRawConfig());
  if (!raw.projects[id]) return { ok: false, error: "project not found" };
  raw.activeProject = id;
  writeRawConfig(raw);
  return { ok: true, ...listProjects(), requiresRestart: id !== CONFIG.activeProject };
}

export function deleteProject(id) {
  if (!isValidProjectId(id)) return { ok: false, error: "invalid project id" };
  const raw = ensureRegistry(readRawConfig());
  if (id === raw.activeProject) return { ok: false, error: "cannot delete the active project" };
  if (!raw.projects[id]) return { ok: false, error: "project not found" };
  delete raw.projects[id];
  writeRawConfig(raw);
  return { ok: true, ...listProjects() };
}
