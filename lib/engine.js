// Engine seam: turns a ticket's chosen engine ("claude" | "codex") into the
// concrete command + argv to spawn, plus the persona/instruction shaping each
// engine needs. The launcher (new ticket runs) and ci-watch (CI / conflict-fix
// runs) both build their subprocess through here so the two engines are wired in
// exactly ONE place.
//
// claude  -> `claude -p <instruction> --output-format stream-json --agent <role>`
// codex   -> `<CODEX_BIN> exec <persona+instruction> --json
//             --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort="…"`
//
// Codex can't read CLAUDE.md and has no --agent, so (a) the role persona body is
// prepended to the prompt and (b) project conventions come from each repo's
// CLAUDE.md via the `project_doc_fallback_filenames` setting in ~/.codex/config.toml.
import { CODEX_BIN, ENGINES_CONFIG } from "./paths.js";
import { getDefaultEngine } from "./state.js";
import { readAgent } from "./agents-config.js";

export const ENGINES = ENGINES_CONFIG.allowed;

// Which engine works this ticket: an explicit, KNOWN ticket.engine wins; else
// the board-wide default (state, defaults "claude").
export function resolveEngine(ticket) {
  if (ticket && ENGINES.includes(ticket.engine)) return ticket.engine;
  return getDefaultEngine();
}

// The exact Claude argv the launcher used to build inline. `useAgent` passes
// --agent <role> and lets the persona frontmatter pin the model (an explicit
// model still overrides); no persona file → a plain --model run.
export function buildClaudeArgs({ useAgent, role, explicitModel, agentModel, instruction }) {
  const args = ["--dangerously-skip-permissions", "--verbose"];
  if (useAgent) {
    args.push("--agent", role);
    if (explicitModel) args.push("--model", explicitModel);
  } else {
    args.push("--model", explicitModel || agentModel);
  }
  args.push("--output-format", "stream-json", "-p", instruction);
  return args;
}

// The Codex headless argv. Full sandbox bypass is the 1:1 of Claude's
// --dangerously-skip-permissions (safe: each ticket runs in its own worktree).
// --json gives a JSONL event stream we parse for tokens. cwd is Codex's working
// root (the workspace; the instruction tells it to cd into the worktree for repo
// work, same as Claude). The launcher passes the resolved role/default model so
// Codex does not silently fall back to config.toml.
export function buildCodexArgs({ instruction, model, effort, cwd }) {
  const args = [
    "exec",
    instruction,
    "-C",
    cwd,
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "-c",
    `model_reasoning_effort="${effort}"`,
  ];
  if (model) args.push("-m", model);
  return args;
}

// Prepend the role persona to a base instruction for Codex (Claude gets the same
// persona via --agent). Best-effort: a missing/unreadable persona just yields the
// bare instruction.
export function codexInstruction(role, baseInstruction) {
  let preamble = "";
  try {
    const a = readAgent(role);
    if (a && a.body && a.body.trim()) {
      preamble = `${a.body.trim()}\n\n---\n\n`;
    }
  } catch {
    /* no persona → run with the bare instruction */
  }
  return preamble + baseInstruction;
}

// The codex binary command (full path to the Codex.app Rust CLI).
export const CODEX_COMMAND = CODEX_BIN;
