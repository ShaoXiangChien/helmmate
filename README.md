# HelmMate

HelmMate is a local cockpit for AI coding work.

It helps engineers and technical PMs turn product asks into agent-ready tickets,
then steer Codex, Claude Code, and other local coding agents through real repos,
branches, worktrees, logs, and human review.

It is not trying to run your whole company. It is trying to make your existing
AI engineering workflow less chaotic.

```text
idea -> agent-ready ticket -> local board -> bounded agent run -> PR handoff -> human review
```

## Why HelmMate

AI coding agents are getting good enough to do real work, but the surrounding
workflow is still messy:

- fuzzy requests become vague prompts;
- tickets miss context, dependencies, or acceptance criteria;
- agents run in the wrong repo or branch;
- logs, cost, and handoff notes scatter across tools;
- humans still need to review the final work, but the review context is thin.

HelmMate keeps the workflow close to the software delivery primitives technical
teams already understand: repo, branch, worktree, ticket, dependency,
acceptance criteria, test command, PR, and review.

## What Makes It Different

- **Engineering-native:** HelmMate maps work to repos, branches, worktrees,
  tickets, and PR handoffs instead of org charts or "AI employees."
- **Local-first:** JSON tickets, local logs, local subprocesses, and a server
  bound to `127.0.0.1` by default.
- **Agent-ready tickets:** tickets carry repo, status, priority, dependencies,
  context refs, branch naming, acceptance criteria, and notes.
- **Review-gated execution:** the board starts disarmed, autopilot starts off,
  WIP limits are enforced, and finished work stops at human review.
- **Multi-project aware:** keep multiple project configs in one local cockpit,
  while preserving a lightweight setup for a single repo.
- **Skill-driven setup:** slash-command friendly skills help agents set up
  projects, create tickets, work tickets, fix PRs, sync memory, and diagnose the
  board.

## Quick Start

```bash
npm install
npm run init
npm start
```

Then open [http://127.0.0.1:4317](http://127.0.0.1:4317).

The package and CLI still use `dev-board` while the product name settles:

```bash
npx dev-board new-ticket --title "Add auth smoke test" --repo workspace --priority P1
npx dev-board validate --fix
npx dev-board start
```

## Agent-Assisted Setup

The easiest setup path is to let a coding agent inspect the repo and write the
boring config.

In Codex, Claude Code, or any agent that supports slash commands:

```text
Run /helm-setup-project to onboard this repository into HelmMate.
Create or update devboard.config.json, initialize local folders, preserve
unrelated project entries, run npm run validate:tickets, and do not arm HelmMate.
```

If the slash command is unavailable, point the agent at
`skills/helm-setup-project/SKILL.md` and ask it to follow that workflow.

The Projects tab can also generate one copyable setup prompt from a project ID,
name, workspace path, and ticket prefix. Use:

- **Existing repo** to import conservative defaults for a repository that
  already exists.
- **New project** to save a clean HelmMate project entry after the repo scaffold
  exists.
- **Advanced config** only for multi-repo setups, custom prompts, or nonstandard
  statuses.

## Agent Skills

Reusable skill templates live in `skills/`:

```text
/helm-setup-project   onboard an existing or new project
/helm-create-ticket   turn rough notes into valid JSON tickets
/helm-work-ticket     work one ticket through PR handoff
/helm-fix-pr          repair CI failures, conflicts, or review blockers
/helm-memory-sync     propose durable project-memory updates
/helm-doctor          diagnose setup, config, tickets, engines, and worktrees
```

The slash command is the user-facing entry. The skill file is the execution
manual that keeps agent behavior consistent across Codex, Claude Code, and other
agent surfaces.

## Safety Model

HelmMate is intentionally conservative:

- the server binds to `127.0.0.1` by default;
- the board starts disarmed;
- autopilot starts off;
- WIP limits block runaway launches;
- tickets must pass dependency and preflight checks before launch;
- agent sessions are local subprocesses;
- the board does not merge pull requests.

Treat ARM as a live trigger. Setup commands and project onboarding should never
arm the board or enable autopilot.

## Configuration

Runtime configuration lives in `devboard.config.json`. Environment variables can
override common settings such as `DEVBOARD_PORT`, `DEVBOARD_HOST`,
`DEVBOARD_WORKSPACE_DIR`, `DEVBOARD_TICKETS_DIR`, `DEVBOARD_AGENT_ENGINE`, and
`DEVBOARD_CODEX_BIN`.

For multiple projects, add entries under `projects` and set `activeProject`.
The current server resolves paths at startup, so changing the active project in
the UI is persisted immediately but takes effect after restarting the server.

Important fields:

- `workspaceDir`: base directory for repo paths, prompt files, and relative refs.
- `ticketsDir`: directory containing ticket JSON files and `_index.json`.
- `ticketIdPrefix`: prefix used by the ticket CLI, such as `DB`.
- `repos`: repo keys, paths, base branches, worktree behavior, and roles.
- `statuses`: board columns. The default flow is `triage`, `backlog`,
  `queued`, `in_progress`, `blocked`, `human_review`, `done`.
- `agentDir`: local persona directory for role files.
- `memoryQueueDir`: directory for proposed memory updates.
- `engines`: allowed launch engines and the default engine.

## Ticket Shape

Tickets are JSON files in the configured `ticketsDir`. The validator requires:

- `id`
- `title`
- `status`
- `priority`
- `repo`
- `depends_on`
- `description`
- `acceptance_criteria`
- `context_refs`
- `branch`
- `notes`

Project-specific data can live in `custom`, `metadata`, or additional fields.
Schemas are included in `schemas/`.

Status semantics:

- `queued` means a launch was requested but no agent session exists yet, usually
  because the board is disarmed or the WIP limit is full.
- `in_progress` means an agent process was launched and recorded in WIP.
- `blocked` is for ticket problems, unmet dependencies, preflight failure, or
  launch failures that need human attention.

## Roadmap

See [OPEN_SOURCE_PLAN.md](./OPEN_SOURCE_PLAN.md) for the extraction plan,
[IMPROVEMENTS.md](./IMPROVEMENTS.md) for the public roadmap, and
[docs/strategy/paperclip-differentiation.md](./docs/strategy/paperclip-differentiation.md)
for the positioning notes that shaped this direction.
