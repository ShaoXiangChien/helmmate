---
name: helm-setup-project
description: Set up or update a HelmMate project configuration and local scaffold. Use when the user wants an agent to onboard an existing repository or new project into HelmMate, inspect repo facts, configure workspace/tickets/repos/statuses/engines, initialize local folders, preserve existing project config, or prepare a multi-project HelmMate registry without arming the board.
---

# HelmMate Setup Project

## Inputs

Use explicit user-provided values when present:

- mode: `existing` or `new`
- project ID
- project name
- workspace directory
- ticket ID prefix
- preferred engine
- whether to switch the active project

If values are missing, infer conservative defaults from the repo and state your
assumptions before finishing.

## Workflow

1. Confirm the HelmMate repo root and the target project workspace. They may be
   the same directory, but do not assume they are.
2. Inspect the target workspace read-only:
   - git root and current branch
   - configured remotes
   - likely base branch (`main`, `master`, or current branch)
   - package manager and likely test command
   - existing `tickets/`, `.agents/`, `memory/sync-queue/`, prompt files, and
     `devboard.config.json`
3. Read the HelmMate `devboard.config.json` if present. Preserve unrelated
   project entries and top-level defaults.
4. Decide whether the user is configuring the active project or adding another
   project entry. If uncertain, add/update the project entry but do not switch
   `activeProject`.
5. Preview the intended changes in plain language before editing:
   - project entry to create/update
   - folders to initialize
   - repo key/path/base branch/worktree choice
   - engine defaults
   - restart requirement, if any
6. Create or update only the needed config fields:
   - `activeProject`
   - `projects.<id>.name`
   - `workspaceDir`
   - `ticketsDir`
   - `ticketIdPrefix`
   - `repos`
   - `statuses`
   - `agentDir`
   - `memoryQueueDir`
   - prompt paths
   - `engines`
7. Initialize folders with `npm run init` or `node bin/dev-board.mjs init` when
   appropriate.
8. Validate the result with `npm run validate:tickets`.
9. If available, run the doctor skill or its lightweight checks after setup.

## Defaults

Use these conservative defaults unless the user or repo context says otherwise:

```json
{
  "workspaceDir": ".",
  "ticketsDir": "tickets",
  "ticketIdPrefix": "DB",
  "repos": {
    "workspace": { "path": ".", "baseBranch": "main", "worktree": false, "role": "cross-repo" }
  },
  "statuses": ["triage", "backlog", "in_progress", "blocked", "human_review", "done"],
  "agentDir": ".agents",
  "memoryQueueDir": "memory/sync-queue",
  "engines": { "default": "claude", "allowed": ["claude", "codex"] }
}
```

## Repo Config Heuristics

- Use repo key `workspace` for a single-repo project unless the user requested a
  custom key.
- Use `worktree: false` for the first conservative setup. Mention that worktrees
  can be enabled later for safer concurrent agent runs.
- Prefer the detected default branch. Fall back to `main`.
- Keep prompt paths as defaults even if the prompt files do not exist yet; report
  missing prompt files as follow-up setup work.
- Keep new or imported tickets in `triage`. Do not seed work directly into
  `in_progress`.

## Multi-Project Rule

When adding a second project, put project-specific paths under `projects.<id>` and set `activeProject` only if the user asks to switch. Tell the user that the current server resolves paths at startup, so switching active project in config takes effect after restart.

## Safety

Never arm the board or enable autopilot as part of setup. Setup creates config
and folders only.

Do not delete or rewrite existing tickets unless the user explicitly asks.
Do not reset git state, discard local changes, remove worktrees, or change
branches unless the user explicitly asks.

## Final Report

Finish with:

- what changed;
- what was preserved;
- detected repo facts;
- validation result;
- whether the HelmMate server must restart;
- any assumptions or missing files;
- the next safe action, usually "review config, keep disarmed, then create or
  import a triage ticket."
