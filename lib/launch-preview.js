import fs from "node:fs";
import path from "node:path";
import {
  AGENT_MODEL,
  CODEX_BIN,
  OPENCODE_BIN,
  REPOS,
  SCRIPTS_PROMPT,
  TICKETS_REF,
  WORK_PROMPT_REF,
  WORKSPACE_DIR,
} from "./paths.js";
import { resolveEngine, buildClaudeArgs, buildCodexArgs, buildOpenCodeArgs } from "./engine.js";
import { branchForTicket } from "./launcher.js";
import { readTicket } from "./tickets.js";
import { WORKTREES_DIR } from "./worktrees.js";
import {
  agentFileExists,
  agentFilePath,
  codexEffort,
  codexModel,
  effectiveModel,
  opencodeModel,
  opencodeVariant,
  resolveRole,
} from "./roles.js";
import { isArmed, runningIds, isRunning, getWipLimit } from "./state.js";
import { launchPreflight } from "./validation.js";

function source(ticket, field, fallback) {
  return ticket && ticket[field] ? "ticket override" : fallback;
}

function previewWorktree(ticket, branch) {
  const repo = ticket.repo;
  const repoConfig = REPOS[repo] || null;
  if (!repoConfig) {
    return {
      mode: "unknown",
      path: null,
      branch,
      repo,
      baseBranch: "main",
      configuredWorktree: null,
      exists: false,
    };
  }

  const baseBranch = "main";
  if (!repoConfig.worktree) {
    return {
      mode: "in-place",
      path: repoConfig.path,
      branch,
      repo,
      baseBranch,
      configuredWorktree: false,
      exists: fs.existsSync(repoConfig.path),
    };
  }

  const wtPath = path.join(WORKTREES_DIR, ticket.id, repo);
  return {
    mode: "worktree",
    path: wtPath,
    branch,
    repo,
    baseBranch,
    configuredWorktree: true,
    exists: fs.existsSync(wtPath),
    parentExists: fs.existsSync(path.dirname(wtPath)),
    repoPath: repoConfig.path,
    repoExists: fs.existsSync(repoConfig.path),
  };
}

function commandPreview({ engine, role, ticket, model, effort, variant, useAgent }) {
  if (engine === "codex") {
    const args = buildCodexArgs({
      instruction: "<role persona + ticket instruction>",
      model,
      effort,
      cwd: WORKSPACE_DIR,
    });
    return {
      binary: CODEX_BIN,
      summary: `${CODEX_BIN} exec <role persona + ticket instruction> -C ${WORKSPACE_DIR} --json -c model_reasoning_effort="${effort}" -m ${model}`,
      args,
    };
  }
  if (engine === "opencode") {
    const args = buildOpenCodeArgs({
      instruction: "<role persona + ticket instruction>",
      model,
      variant,
      cwd: WORKSPACE_DIR,
    });
    return {
      binary: OPENCODE_BIN,
      summary:
        `${OPENCODE_BIN} run <role persona + ticket instruction> --dir ${WORKSPACE_DIR} ` +
        `--format json --dangerously-skip-permissions --model ${model}` +
        `${variant ? ` --variant ${variant}` : ""}`,
      args,
    };
  }

  const explicitModel = typeof ticket.model === "string" && ticket.model ? ticket.model : null;
  const args = buildClaudeArgs({
    useAgent,
    role,
    explicitModel,
    agentModel: AGENT_MODEL,
    instruction: "<ticket instruction>",
  });
  const modelPart = useAgent
    ? explicitModel
      ? `--agent ${role} --model ${explicitModel}`
      : `--agent ${role}`
    : `--model ${explicitModel || AGENT_MODEL}`;
  return {
    binary: "claude",
    summary: `claude --dangerously-skip-permissions --verbose ${modelPart} --output-format stream-json -p <ticket instruction>`,
    args,
  };
}

function dependencyBlockers(ticket) {
  const deps = Array.isArray(ticket.depends_on) ? ticket.depends_on : [];
  return deps
    .filter((depId) => {
      const dep = readTicket(depId);
      return !dep || dep.status !== "done";
    })
    .map((depId) => ({
      level: "error",
      code: "unmet_dependency",
      message: `dependency is not done: ${depId}`,
    }));
}

function gateBlockers(ticket) {
  const blockers = [];
  if (isRunning(ticket.id)) {
    blockers.push({ level: "error", code: "already_running", message: "a session is already running for this ticket" });
  }
  if (!isArmed()) {
    blockers.push({ level: "warning", code: "board_disarmed", message: "board is disarmed; launch would queue instead of starting now" });
  }
  const running = runningIds();
  const wipLimit = getWipLimit();
  if (running.length >= wipLimit) {
    blockers.push({
      level: "warning",
      code: "wip_limit",
      message: `WIP limit ${wipLimit} is reached: [${running.join(", ")}]`,
    });
  }
  return blockers;
}

export function buildLaunchPreview(ticket, options = {}) {
  const branch = branchForTicket(ticket);
  const role = resolveRole(ticket);
  const engine = resolveEngine(ticket);
  const usesPromptPreamble = engine === "codex" || engine === "opencode";
  const useAgent = !usesPromptPreamble && agentFileExists(role);
  const effort = engine === "codex" ? codexEffort(ticket) : null;
  const variant = engine === "opencode" ? opencodeVariant(ticket) : null;
  const model =
    engine === "codex"
      ? codexModel(ticket)
      : engine === "opencode"
      ? opencodeModel(ticket)
      : effectiveModel(ticket);
  const preflight = launchPreflight(ticket, {
    statusForRules: options.statusForRules || ticket.status,
  });
  const blockers = [
    ...dependencyBlockers(ticket),
    ...preflight.filter((item) => item.level === "error"),
    ...gateBlockers(ticket).filter((item) => item.level === "error"),
  ];
  const warnings = [
    ...preflight.filter((item) => item.level === "warning"),
    ...gateBlockers(ticket).filter((item) => item.level !== "error"),
  ];
  const worktree = previewWorktree(ticket, branch);
  if (worktree.configuredWorktree && worktree.repoPath && !worktree.repoExists) {
    blockers.push({
      level: "error",
      code: "missing_repo_checkout",
      message: `repo checkout not found: ${worktree.repoPath}`,
    });
  }

  return {
    ticketId: ticket.id,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    willSpawnAgent: false,
    engine: {
      name: engine,
      source: ticket && ticket.engine ? "ticket override" : "board default",
    },
    role: {
      name: role,
      source: source(ticket, "role", "repo default"),
      personaPath: agentFilePath(role),
      personaExists: agentFileExists(role),
      mode: usesPromptPreamble ? "prompt preamble" : useAgent ? "claude agent" : "missing persona fallback",
    },
    model: {
      name: model,
      source:
        engine === "codex"
          ? source(ticket, "codex_model", "role default")
          : engine === "opencode"
          ? source(ticket, "opencode_model", "role default")
          : source(ticket, "model", "persona/default"),
    },
    effort: engine === "codex" ? { name: effort, source: source(ticket, "codex_effort", "role default") } : null,
    variant: engine === "opencode" ? { name: variant || "", source: source(ticket, "opencode_variant", "role default") } : null,
    command: commandPreview({ engine, role, ticket, model, effort, variant, useAgent }),
    cwd: WORKSPACE_DIR,
    branch,
    worktree,
    promptFile: {
      ref: WORK_PROMPT_REF,
      path: SCRIPTS_PROMPT,
      exists: fs.existsSync(SCRIPTS_PROMPT),
    },
    ticketFile: `${TICKETS_REF}/${ticket.id}.json`,
    expectedHandoffStatus: "human_review",
    blockers,
    warnings,
  };
}
