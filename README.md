# HelmMate

<p align="center">
  <img src="./public/hero-banner.png" alt="HelmMate: local launch console for AI coding work" width="720" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="#agent-assisted-setup"><strong>Agent setup</strong></a> &middot;
  <a href="#safety-model"><strong>Safety</strong></a> &middot;
  <a href="#configuration"><strong>Configuration</strong></a> &middot;
  <a href="#roadmap"><strong>Roadmap</strong></a>
</p>

HelmMate is a local launch console for AI coding work.

It turns rough product asks into agent-ready engineering tickets, then helps you
steer Claude Code, Codex, and opencode through real repos,
branches, worktrees, logs, pull requests, and human review.

It looks like a kanban board. Under the hood: JSON tickets, launch preflight,
dependency gates, WIP limits, local subprocesses, run logs, usage checks,
agent roles, and PR handoff.

**Steer bounded engineering work, not open-ended agent chaos.**

|        | Step              | Example                                                                       |
| ------ | ----------------- | ----------------------------------------------------------------------------- |
| **01** | Shape the work    | Turn "auth feels brittle" into a ticket with repo, context, tests, and AC.    |
| **02** | Preview the risk  | Check dependencies, missing CLIs, worktree mode, prompt files, and role route. |
| **03** | Launch on purpose | Arm the board, run the right agent locally, then stop at human review.         |

```text
idea -> agent-ready ticket -> local board -> bounded run -> PR handoff -> review
```

## HelmMate Is Right For You If

- You use Claude Code, Codex, or opencode inside real repos.
- You want AI work packets to include acceptance criteria, context refs, repo
  ownership, branch names, dependencies, and test expectations.
- You have more agent sessions than short-term memory and want a single place to
  see what is queued, running, blocked, or waiting for review.
- You want local-first execution without adopting a heavyweight autonomous
  company platform.
- You like the leverage of agentic coding, but you still want arming, launching,
  reviewing, and memory updates to stay human-led.

## Features

| Feature | What It Does |
| ------- | ------------ |
| **Agent-ready tickets** | Stores work as JSON tickets with repo, status, priority, dependencies, branch, acceptance criteria, context refs, and notes. |
| **Local launch console** | Serves a board on `127.0.0.1` by default, reads local config, writes local logs, and launches local agent CLIs. |
| **Review-gated execution** | Starts disarmed, keeps autopilot off, enforces WIP limits, blocks unmet dependencies, and routes completed work to `human_review`. |
| **Launch preflight** | Checks ticket shape, required acceptance criteria, configured repo keys, agent CLI availability, prompt files, persona files, and PR tooling warnings. |
| **Worktree-aware runs** | Can prepare isolated git worktrees and ticket branches so concurrent sessions do not trample the same checkout. |
| **Agent role routing** | Maps repos and tickets to configured roles, persona files, Codex model/effort defaults, and engine-specific launch arguments. |
| **Multi-project cockpit** | Keeps several project configs in one local board while preserving a simple single-repo setup path. |
| **Skill pack** | Includes reusable agent skills for project setup, ticket creation, ticket work, PR repair, memory sync, and diagnostics. |

## Problems HelmMate Solves

| Without HelmMate | With HelmMate |
| ---------------- | ------------- |
| You paste a vague product ask into an agent and hope it finds the right files. | Tickets carry repo, context refs, dependencies, acceptance criteria, and branch intent before launch. |
| Agent sessions run from the wrong directory, branch, or mental model. | Launch preview shows the repo route, role, engine, worktree mode, prompt files, and blockers. |
| You lose track of which terminal is doing what. | The board shows queued, running, blocked, review, and done work from one local state file. |
| A second agent starts work that depends on unfinished changes. | Dependency checks block launches until prerequisite tickets are done. |
| Finished work arrives with no obvious review handoff. | The work contract tells agents to open a PR, update the ticket, and stop at human review. |
| Useful project knowledge gets buried in logs. | Memory sync proposes durable updates through a review queue instead of silently rewriting your docs. |

## Why HelmMate Is Different

HelmMate is intentionally narrower than broad agent-orchestration tools. The
center of gravity is software delivery.

| | |
| --- | --- |
| **Engineering-native.** | HelmMate speaks repo, branch, worktree, ticket, dependency, test command, PR, and review note. |
| **Local-first.** | JSON tickets, local logs, local subprocesses, and localhost binding keep the first version easy to inspect and hack. |
| **Ticket quality first.** | The product treats context, acceptance criteria, dependency shape, and review handoff as core workflow objects. |
| **Human-led autonomy.** | Agents can do bounded work, but arming, autopilot, launch readiness, PR review, and memory adoption stay explicit. |
| **Small enough to understand.** | No required database, no org-chart theater, no claim that agents are employees, and no auto-merge path. |

## What HelmMate Is Not

| | |
| --- | --- |
| **Not a chatbot.** | It is a cockpit for executable engineering tickets, not another chat window. |
| **Not a company simulator.** | HelmMate does not model CEOs, org charts, departments, or zero-human businesses. |
| **Not a generic kanban clone.** | The board exists to launch, inspect, gate, and review local AI coding work. |
| **Not an agent framework.** | Bring one of the supported CLIs and your prompts. HelmMate coordinates when and how they touch your repos. |
| **Not a merge bot.** | Finished work stops at human review. Pull requests are handoffs, not automatic approvals. |

## What's Under The Hood

```text
+--------------------------------------------------------------+
|                         HELMMATE                             |
|                                                              |
|  +------------+  +------------+  +------------+  +--------+  |
|  |  Tickets   |  |  Config &  |  |  Launch    |  |  Runs  |  |
|  |  + Index   |  |  Projects  |  |  Preview   |  | + Logs |  |
|  +------------+  +------------+  +------------+  +--------+  |
|                                                              |
|  +------------+  +------------+  +------------+  +--------+  |
|  | Preflight  |  | Worktrees  |  | Roles &    |  | Usage  |  |
|  | + Gates    |  | + Branches |  | Personas   |  | Checks |  |
|  +------------+  +------------+  +------------+  +--------+  |
|                                                              |
|  +------------+  +------------+  +------------+  +--------+  |
|  |  Skills    |  | Memory     |  | CI/Review  |  | Board  |  |
|  |  Pack      |  | Queue      |  | Repair     |  | State  |  |
|  +------------+  +------------+  +------------+  +--------+  |
+--------------------------------------------------------------+
          ^                 ^                  ^
    +-----+-----+     +-----+-----+      +-----+-----+
    |   Codex   |     |  Claude   |      | opencode  |
    |    CLI    |     |   Code    |      |    CLI    |
    +-----------+     +-----------+      +-----------+
```

### The Systems

**Tickets and validation** - Tickets live as JSON files in the configured
`ticketsDir`, with `_index.json` regenerated from source files. Validation checks
shape, configured statuses and repos, dependency graph health, context refs, and
review handoff fields.

**Launch and preflight** - The launcher refuses duplicate runs, blocks unmet
dependencies, checks hard preflight failures, queues work when the board is
disarmed or the WIP limit is full, and records every run in local state.

**Worktrees and branches** - Tickets can run in isolated worktrees on predictable
`ticket/<id>-<slug>` branches. Simple projects can run in place when configured
that way.

**Engines and roles** - HelmMate currently knows how to build launch arguments
for Claude Code, Codex, and opencode, route work by repo or ticket role, and
expose role personas, model defaults, and engine warnings in the UI.

**Review and repair** - The ticket work contract asks the agent to implement,
verify, push, open a PR, set the ticket to `human_review`, and stop. Separate
repair prompts help with CI failures and conflicts on existing branches.

**Memory queue** - Agents can propose project-memory updates into a local review
queue. The user decides what becomes durable project context.

## Quickstart

```bash
npm install
npm run init
npm start
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317).

The package and CLI still use `helmmate` while the product name settles:

```bash
npx helmmate new-ticket --title "Add auth smoke test" --repo workspace --priority P1
npx helmmate validate --fix
npx helmmate start
```

Requirements: Node.js 20+ is recommended.

### Prerequisites Before You Launch Work

HelmMate can help create project config and tickets, but a launch-ready project
still needs a few local prerequisites:

| Check | Why It Matters |
| ----- | -------------- |
| **Node.js 20+** | Runs the local server, validator, and CLI scripts. |
| **Git repo access** | Agents need a real checkout, branch access, and optional worktree support. |
| **A coding agent CLI** | Install and authenticate at least one supported launch engine: Claude Code, Codex, or opencode. |
| **HelmMate skills installed** | The onboarding command copies `/helm-*` skills into Codex and Claude skill folders. |
| **Project config loaded** | `helmmate.config.json` must contain an active project with repo mappings. |
| **Ticket queue initialized** | The ticket directory and `_index.json` must exist before tickets can be validated. |
| **Doctor check run** | Use `/helm-doctor` before arming to verify CLIs, git auth, prompt files, personas, and worktree readiness. |

The UI starts disarmed and autopilot off. Do not arm the board until the
launch preview and Doctor output match what you expect.

## Agent-Assisted Setup

The easiest setup path is to install the HelmMate skill pack once, then let
Claude Code, Codex, or opencode inspect your repo and write the routine config.

From the HelmMate repository, install the local skill pack globally for Codex
and Claude Code:

```bash
HELMMATE_DIR="$(pwd)"; mkdir -p "$HOME/.codex/skills" "$HOME/.claude/skills"; for skill in "$HELMMATE_DIR"/skills/helm-*; do name="$(basename "$skill")"; rsync -a --delete "$skill/" "$HOME/.codex/skills/$name/"; rsync -a --delete "$skill/" "$HOME/.claude/skills/$name/"; done
```

Then open Claude Code, Codex, or opencode from the target project folder and
paste the setup prompt generated by the HelmMate onboarding screen.

For an existing repo, the prompt will ask the agent to run:

```text
/helm-setup-project
```

For a fresh project, it will ask the agent to run:

```text
/helm-init
```

If slash commands are unavailable, the generated prompt includes the exact
fallback skill file path in this HelmMate checkout.

After setup, run the Doctor prompt from the onboarding or Projects page before
arming the board. Doctor is the practical prerequisite audit: it asks the agent
to verify git auth, available launch CLIs, prompt files, role personas, ticket
validation, worktree behavior, and PR handoff readiness.

- **Existing repo:** import conservative defaults for a repository that already exists.
- **New project:** create a minimal starter workspace, then register it.
- **No manual IDs:** the agent infers project ID, ticket prefix, repo key, folders, and statuses.
- **First ticket:** after setup, open the Board. If no tickets exist, HelmMate
  shows a copyable `helm-create-ticket` prompt for your project agent.
- **Advanced config:** tune multi-repo setups, custom prompts, or nonstandard
  statuses.

## Agent Skills

Reusable skill templates live in `skills/`:

```text
/helm-init            initialize a fresh project and register it
/helm-setup-project   onboard an existing or new project
/helm-create-ticket   turn rough notes into valid JSON tickets
/helm-work-ticket     work one ticket through PR handoff
/helm-fix-pr          repair CI failures, conflicts, or review blockers
/helm-memory-sync     propose durable project-memory updates
/helm-doctor          diagnose setup, config, tickets, engines, and worktrees
```

The slash command is the user-facing entry for Claude Code and Codex. The skill
file is the execution manual that keeps agent behavior consistent across Claude
Code, Codex, and opencode handoff prompts.

## Safety Model

HelmMate is intentionally conservative:

- the server binds to `127.0.0.1` by default;
- the board starts disarmed;
- autopilot starts off;
- WIP limits block runaway launches;
- tickets must pass dependency and preflight checks before launch;
- agent sessions are local subprocesses;
- launches use powerful local agent CLI permissions and should be treated as
  deliberate operator actions;
- the board does not merge pull requests.

Treat ARM as a live trigger. Setup commands and project onboarding should never
arm the board or enable autopilot.

## Configuration

Runtime configuration lives in `helmmate.config.json`. Environment variables can
override common settings such as `HELMMATE_PORT`, `HELMMATE_HOST`,
`HELMMATE_WORKSPACE_DIR`, `HELMMATE_TICKETS_DIR`, `HELMMATE_AGENT_ENGINE`, and
`HELMMATE_CODEX_BIN` or `HELMMATE_OPENCODE_BIN`.

For a new checkout, copy `helmmate.config.example.json` to
`helmmate.config.json` or let the onboarding setup prompt create it. The real
`helmmate.config.json` is ignored by git because it contains local workspace
paths.

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

- `triage` means rough imported work that should be reviewed before launch.
- `backlog` means reviewed work that may be launch-ready if preflight passes.
- `queued` means a launch was requested but no agent session exists yet, usually
  because the board is disarmed or the WIP limit is full.
- `in_progress` means an agent process was launched and recorded in WIP.
- `blocked` is for ticket problems, unmet dependencies, preflight failure, or
  launch failures that need human attention.
- `human_review` means the agent should be done and a human should inspect the
  branch or PR before marking the ticket done.

## Development

```bash
npm run dev              # Vite frontend dev server
npm start                # Express API + static UI
npm run build            # Build the React entrypoint
npm run validate:tickets # Validate ticket files and index state
```

## Roadmap

See [OPEN_SOURCE_PLAN.md](./OPEN_SOURCE_PLAN.md) for the extraction plan,
[IMPROVEMENTS.md](./IMPROVEMENTS.md) for the public roadmap, and
[docs/strategy/paperclip-differentiation.md](./docs/strategy/paperclip-differentiation.md)
for positioning notes that shaped this direction.

Near-term themes:

- Doctor page for setup, CLI, git, ticket, and worktree readiness.
- Safer dry-run launch mode and clearer dangerous-permission visibility.
- Better ticket editing, ticket linting, and note import from the UI.
- A more formal engine interface for Claude Code, Codex, and opencode.

## License

MIT. See [LICENSE](./LICENSE).
