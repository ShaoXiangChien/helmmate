function clean(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanEngine(value) {
  const text = clean(value, "unknown");
  return text.toLowerCase() === "unknown" ? "not specified" : text;
}

export function buildSetupAgentPrompt(input = {}) {
  const mode = clean(input.mode, "existing");
  const projectId = clean(input.projectId, "default");
  const name = clean(input.name, projectId);
  const workspaceDir = clean(input.workspaceDir, ".");
  const ticketPrefix = clean(input.ticketIdPrefix, "DB");
  const preferredEngine = cleanEngine(input.preferredEngine || input.engine);

  return [
    "Use HelmMate's setup skill to onboard this project. Do not perform ticket execution.",
    "",
    "Preferred path:",
    "- If `/helm-setup-project` is available, run it.",
    "- If slash commands are unavailable, use the `helm-setup-project` skill directly.",
    "- If the skill is not installed, read the exact fallback path `skills/helm-setup-project/SKILL.md` from this HelmMate repository and follow it exactly.",
    "",
    "Exact setup intent from the user:",
    `- Mode: ${mode === "new" ? "new project scaffold" : "existing repository import"}`,
    `- Project ID: ${projectId}`,
    `- Project name: ${name}`,
    `- Workspace directory: ${workspaceDir}`,
    `- Ticket ID prefix: ${ticketPrefix}`,
    `- Preferred engine: ${preferredEngine}`,
    "",
    "Before editing anything:",
    "- Inspect the target workspace read-only.",
    "- Detect git root, current branch, default branch guess, remote URL/provider, package manager, likely test command, repo name, dirty working tree, and existing HelmMate folders/files.",
    "- Read any existing `devboard.config.json` and preserve unrelated project entries and top-level defaults.",
    "- Check for existing `tickets/`, `.agents/`, `memory/sync-queue/`, and prompt files.",
    "- Preview the config and folder changes you intend to make before editing.",
    "",
    "Expected result:",
    "- Create or update the project entry in `devboard.config.json`.",
    "- Use conservative defaults for tickets, statuses, agents, memory queue, prompts, and repos.",
    "- Use `workspace` as the repo key for a simple single-repo setup unless repo context clearly suggests otherwise.",
    "- Keep worktrees disabled for the first conservative setup unless explicitly requested.",
    "- Preserve unrelated project entries and top-level defaults.",
    "- Initialize local folders with `npm run init` or `node bin/dev-board.mjs init` when appropriate.",
    "- Run `npm run validate:tickets` before finishing.",
    "- Run or recommend `helm-doctor` as the follow-up readiness check after setup.",
    "",
    "Hard safety requirements:",
    "- Do not arm HelmMate.",
    "- Do not enable autopilot.",
    "- Do not delete tickets.",
    "- Do not reset git state.",
    "- Do not remove worktrees.",
    "- Do not switch branches unless the user explicitly asks.",
    "",
    "After setup, summarize detected repo facts, what changed, what was preserved, validation results, whether the server needs a restart, and any assumptions or missing files.",
  ].join("\n");
}

export function setupAgentCommands(input = {}) {
  const prompt = buildSetupAgentPrompt(input);
  return {
    ok: true,
    prompt,
  };
}

function bullet(label, value) {
  return `- ${label}: ${clean(value, "unknown")}`;
}

function repoLines(repos = []) {
  if (!Array.isArray(repos) || repos.length === 0) return ["- Configured repos: none detected"];
  return repos.map((repo) => {
    const key = clean(repo.key, "unknown");
    const exists = repo.exists === true ? "exists" : repo.exists === false ? "missing" : "unknown";
    const path = clean(repo.path, "unknown path");
    const base = repo.baseBranch ? `, base ${repo.baseBranch}` : "";
    const worktree = repo.worktree ? ", worktrees enabled" : "";
    return `- Repo ${key}: ${exists} at ${path}${base}${worktree}`;
  });
}

export function buildDoctorAgentPrompt(input = {}) {
  const setup = input.setup && typeof input.setup === "object" ? input.setup : {};
  const state = input.state && typeof input.state === "object" ? input.state : {};
  const repos = Array.isArray(setup.repoStatus) ? setup.repoStatus : [];

  return [
    "Run HelmMate Doctor for this repository. Stay read-only unless I explicitly ask you to fix something.",
    "",
    "Preferred path:",
    "- If `/helm-doctor` is available, run it.",
    "- If slash commands are unavailable, use the `helm-doctor` skill directly.",
    "- If the skill is not installed, read the exact fallback path `skills/helm-doctor/SKILL.md` from this HelmMate repository and follow it exactly.",
    "",
    "Current HelmMate UI facts:",
    bullet("Config path", setup.configPath),
    bullet("Configured active project", setup.configuredActiveProject || setup.activeProject),
    bullet("Runtime active project", setup.runtimeActiveProject || setup.activeProject),
    bullet("Workspace directory", setup.workspaceDir),
    bullet("Tickets directory", setup.ticketsDir),
    bullet("Ticket index", setup.indexExists ? "exists" : "missing"),
    bullet("Restart needed", setup.requiresRestart ? setup.restartReason || "yes" : "no"),
    bullet("Board armed", state.armed === true ? "yes" : state.armed === false ? "no" : "unknown"),
    bullet("Autopilot", state.autopilot === true ? "on" : state.autopilot === false ? "off" : "unknown"),
    bullet("Running tickets", Array.isArray(state.running) && state.running.length ? state.running.join(", ") : "none reported"),
    ...repoLines(repos),
    "",
    "Doctor scope:",
    "- Classify findings as Blockers, Warnings, or Healthy checks.",
    "- Verify setup/config drift, active project vs runtime project, restart state, ticket directory/index, configured repos, and board armed/autopilot state.",
    "- Run or recommend `npm run validate:tickets` and report the result.",
    "- Check deeper readiness: git auth, git remotes, CLI availability for configured engines, dirty worktrees, base branches, branch collisions, prompt files, persona files, PR readiness, worktree directory health, local host binding, and running/WIP process reconciliation.",
    "- Use exact file paths and commands in the report.",
    "",
    "Safety requirements:",
    "- Do not arm HelmMate.",
    "- Do not enable autopilot.",
    "- Do not edit config, tickets, prompts, or persona files unless I ask for fixes.",
    "- Do not delete worktrees, reset git state, switch branches, push, create PRs, or kill processes unless I explicitly ask.",
    "",
    "Finish with a concise recommendation: safe to arm, safe after warnings, or blocked.",
  ].join("\n");
}

export function doctorAgentCommands(input = {}) {
  const prompt = buildDoctorAgentPrompt(input);
  return {
    ok: true,
    prompt,
  };
}
