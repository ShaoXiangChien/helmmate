function clean(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function buildSetupAgentPrompt(input = {}) {
  const mode = clean(input.mode, "existing");
  const projectId = clean(input.projectId, "default");
  const name = clean(input.name, projectId);
  const workspaceDir = clean(input.workspaceDir, ".");
  const ticketPrefix = clean(input.ticketIdPrefix, "DB");

  return [
    "Use the HelmMate setup workflow to onboard this project.",
    "",
    "Preferred path:",
    "- If `/helm-setup-project` is available, run it.",
    "- If slash commands are unavailable, use the `helm-setup-project` skill directly.",
    "- If the skill is not installed, read `skills/helm-setup-project/SKILL.md` from this HelmMate repository and follow it exactly.",
    "",
    "Setup intent:",
    `- Mode: ${mode === "new" ? "new project scaffold" : "existing repository import"}`,
    `- Project ID: ${projectId}`,
    `- Project name: ${name}`,
    `- Workspace directory: ${workspaceDir}`,
    `- Ticket ID prefix: ${ticketPrefix}`,
    "",
    "Before editing anything:",
    "- Inspect the target workspace read-only.",
    "- Detect git root, current branch, remotes, likely base branch, package manager, likely test command, and existing HelmMate folders/files.",
    "- Read any existing `devboard.config.json` and preserve unrelated project entries and top-level defaults.",
    "- Briefly preview the config/folder changes you intend to make.",
    "",
    "Expected result:",
    "- Create or update the project entry in `devboard.config.json`.",
    "- Use conservative defaults for tickets, statuses, agents, memory queue, prompts, and repos.",
    "- Use `workspace` as the repo key for a simple single-repo setup unless repo context clearly suggests otherwise.",
    "- Keep worktrees disabled for the first conservative setup unless explicitly requested.",
    "- Preserve unrelated project entries and top-level defaults.",
    "- Initialize local folders with `npm run init` or `node bin/dev-board.mjs init` when appropriate.",
    "- Run `npm run validate:tickets` before finishing.",
    "- Do not arm HelmMate and do not enable autopilot.",
    "",
    "After setup, summarize detected repo facts, what changed, what was preserved, validation results, whether the server needs a restart, and any assumptions or missing files.",
  ].join("\n");
}

export function setupAgentCommands(input = {}) {
  const prompt = buildSetupAgentPrompt(input);
  return {
    prompt,
  };
}
