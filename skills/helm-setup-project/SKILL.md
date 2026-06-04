---
name: helm-setup-project
description: Set up or update a HelmMate project configuration and local scaffold. Use when the user wants an agent to onboard an existing repository or new project into HelmMate, inspect repo facts, configure workspace/tickets/repos/statuses/engines, initialize local folders, preserve existing project config, or prepare a multi-project HelmMate registry without arming the board.
---

# HelmMate Setup Project

This skill is the handoff contract for external coding agents such as Claude
Code, Codex, or another local repo agent. The HelmMate UI may only provide user
intent; this skill performs the repo inspection, previews intended changes, then
updates config and local scaffold files when appropriate.

## Inputs

Use explicit user-provided values when present:

- mode: `existing` or `new`
- project ID
- project name
- workspace directory
- ticket ID prefix
- preferred engine, if known
- whether to switch the active project

If a value is missing, infer a conservative default from repo context and state
the assumption in the final report.

Do not ask the user to invent HelmMate internals such as project IDs, ticket
prefixes, repo keys, status lists, folder names, or prompt paths. Infer them
from the repo/folder and existing HelmMate config. Ask at most one clarifying
question only when the target folder or project stack cannot be identified
safely.

## Non-Negotiable Safety

- Inspect read-only before editing.
- Preview intended config and folder changes before editing.
- Never arm HelmMate.
- Never enable autopilot.
- Do not delete tickets.
- Do not reset or discard git state.
- Do not remove worktrees.
- Do not switch branches unless the user explicitly asks.
- Preserve unrelated `helmmate.config.json` project entries and top-level
  defaults.

## Read-Only Inspection Checklist

Confirm the HelmMate repository root and the target project workspace. They may
be the same directory, but do not assume they are.

If the prompt includes an explicit HelmMate repository path, use that path for
`helmmate.config.json`, `skills/`, and `npm run init`. Use the target workspace
path for repo inspection and project scaffold checks.

Inspect the target workspace without changing files:

- git root
- current branch
- default branch guess (`main`, `master`, remote HEAD, or current branch)
- remote URL and provider guess
- package manager
- likely test command
- repo name
- dirty working tree
- existing `helmmate.config.json`
- existing `tickets/`
- existing `.agents/`
- existing `memory/sync-queue/`
- prompt files present or missing

Useful read-only commands:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git remote -v
git remote show origin
git status --short
ls
find . -maxdepth 3 -type f \( -name "package.json" -o -name "pnpm-lock.yaml" -o -name "yarn.lock" -o -name "package-lock.json" -o -name "uv.lock" -o -name "pyproject.toml" -o -name "Cargo.toml" -o -name "go.mod" \)
```

Only run commands that make sense for the workspace and shell. Do not run
install, build, test, format, or migration commands during inspection.

## Config Rules

Read HelmMate's `helmmate.config.json` before editing. Preserve unrelated
project entries, unknown fields, and top-level defaults unless the user
explicitly asks to change them.

When adding or updating a project, write only fields needed for setup:

- `projects.<id>.name`
- `projects.<id>.workspaceDir`
- `projects.<id>.ticketsDir`
- `projects.<id>.ticketIdPrefix`
- `projects.<id>.repos`
- `projects.<id>.statuses`
- `projects.<id>.agentDir`
- `projects.<id>.memoryQueueDir`
- `projects.<id>.workPrompt`
- `projects.<id>.fixCiPrompt`
- `projects.<id>.fixConflictPrompt`
- `projects.<id>.engines`
- `activeProject`, only when the user explicitly asks to switch

Use repo key `workspace` for a simple single-repo setup unless the user or repo
context clearly suggests another key. Set `worktree: false` for the first
conservative setup unless the user requests worktrees.

For a first-run handoff, set `activeProject` to the new/updated project unless
the prompt explicitly says not to or the existing config clearly indicates the
user is intentionally managing multiple projects manually.

## Conservative Defaults

Use these defaults unless user input or repo inspection provides a better
answer:

```json
{
  "workspaceDir": ".",
  "ticketsDir": "tickets",
  "ticketIdPrefix": "DB",
  "repos": {
    "workspace": {
      "path": ".",
      "baseBranch": "main",
      "worktree": false,
      "role": "cross-repo"
    }
  },
  "statuses": ["triage", "backlog", "queued", "in_progress", "blocked", "human_review", "done"],
  "agentDir": ".agents",
  "memoryQueueDir": "memory/sync-queue",
  "workPrompt": "scripts/work-ticket-prompt.md",
  "fixCiPrompt": "scripts/fix-ci-prompt.md",
  "fixConflictPrompt": "scripts/fix-conflict-prompt.md",
  "engines": { "default": "claude", "allowed": ["claude", "codex"] }
}
```

Engine guidance:

- If the user named `claude`, set default engine to `claude`.
- If the user named `codex`, set default engine to `codex`.
- If unknown, prefer an existing configured default; otherwise use `claude`.
- Keep `allowed` broad enough for both `claude` and `codex` unless the user asks
  to restrict engines.

Package manager and test command are inspection facts for the final report. Do
not invent a test command if none is obvious.

For new-project mode, if the target workspace is missing or empty, preview a
minimal scaffold first. Prefer the user's surrounding request and folder name for
the stack. If no stack is inferable, create only a minimal README and HelmMate
support scaffold rather than making an arbitrary app.

## Preview Before Editing

Before writing files, show a concise preview:

- project entry to create or update
- whether `activeProject` will change
- repo key, repo path, base branch, worktree setting, and role
- engine default and allowed engines
- folders to initialize
- prompt paths that exist or are missing
- whether a HelmMate server restart will be needed
- validation command to run after edits

Stop for user confirmation when the preview changes existing project config in a
non-obvious way, switches `activeProject`, or touches anything outside the
expected config/scaffold files.

## Apply Setup

After preview, make the smallest necessary edits.

Initialize local scaffold when appropriate:

```bash
npm run init
```

If npm scripts are not available from the HelmMate repo root, use:

```bash
node bin/helmmate.mjs init
```

Expected scaffold:

- tickets directory
- ticket index
- agent directory
- memory sync queue directory

Do not create starter tickets unless the user explicitly asks.

## Validate

Run:

```bash
npm run validate:tickets
```

If that command is unavailable, run:

```bash
node bin/validate-tickets.mjs
```

After setup, keep `helm-doctor` as the follow-up readiness check. If the doctor
skill is available, run it or tell the user to run `/helm-doctor`. If not, read
`skills/helm-doctor/SKILL.md` and perform its lightweight checks.

## Multi-Project Rule

When adding another project, put project-specific paths under `projects.<id>`.
Do not change `activeProject` unless the user explicitly asks. If `activeProject`
changes, explain that the current server resolves project paths at startup and
must restart before the UI uses the new paths.

## Final Report

Finish with:

- detected repo facts
- what changed
- what was preserved
- validation result
- whether the HelmMate server must restart
- prompt files or folders still missing
- assumptions made
- next safe action, usually: review config, keep HelmMate disarmed, run
  HelmMate Doctor, then create or import a triage ticket
