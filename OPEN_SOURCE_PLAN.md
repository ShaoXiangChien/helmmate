# Open-source extraction plan

Goal: turn this Plander-specific dev-board into a standalone local dashboard for
agent-driven ticket queues: tickets -> board -> optional autonomous launch ->
PR -> human review -> done.

## Current state

The copied source is intentionally clean: `node_modules/`, `logs/`,
`worktrees/`, `.state.json`, `.runs.json`, and usage caches were left behind.

What is already strong:

- Plain Express server, vanilla frontend, no build pipeline.
- JSON ticket files plus `_index.json` are easy to understand and inspect.
- Strong safety defaults: disarmed board, WIP limit, dependency checks,
  preflight, worktrees, stop/resume, circuit breaker, human review gate.
- Useful higher-end features already exist: usage-aware scheduler, CI/conflict
  fix dispatch, agent role routing, memory sync queue.

What is currently too project-specific:

- Paths assume the board lives at `<workspace>/dev-board` and tickets live at
  `<workspace>/tickets`.
- Repo names are hard-coded to `plander-api`, `plander-ios`, and `workspace`.
- Ticket IDs, branches, docs, and prompts assume the `PL-NNN` Plander workflow.
- UI branding and copy say "Plander", "Eric", "Claude ran out", etc.
- Agent personas are read from `<workspace>/.claude/agents/*.md`.
- Memory queue is fixed to `memory/sync-queue/*.md`.
- Launch prompts assume `scripts/work-ticket-prompt.md` and specific PR rules.
- Usage probes are Claude/Codex-specific and should become optional providers.

## Phase 0: repo hygiene

- Choose repo name. Good candidates: `dev-board`, `agent-dev-board`,
  `local-agent-board`, or `review-gated-board`.
- Initialize git in `/Users/ericchien/Desktop/Startup/dev-board`.
- Add `LICENSE` (MIT is simplest; Apache-2.0 if patent language matters).
- Add `SECURITY.md` explaining that the app launches local agent CLIs and should
  be treated as a local-only tool.
- Add `CONTRIBUTING.md` with the safety model: no auto-merge, human review gate,
  triage gate, disarmed by default.
- Replace `IMPROVEMENTS.md` with a public roadmap, preserving useful ideas but
  removing Plander/Eric-specific phrasing.

## Phase 1: make it configurable

Add `devboard.config.json` at the workspace root and let env vars override it.

Suggested config shape:

```json
{
  "workspaceDir": ".",
  "ticketsDir": "tickets",
  "ticketIdPrefix": "DB",
  "defaultPort": 4317,
  "repos": {
    "workspace": { "path": ".", "baseBranch": "main", "worktree": false }
  },
  "statuses": ["triage", "backlog", "in_progress", "blocked", "human_review", "done"],
  "agentDir": ".agents",
  "memoryQueueDir": "memory/sync-queue",
  "workPrompt": "scripts/work-ticket-prompt.md",
  "fixCiPrompt": "scripts/fix-ci-prompt.md",
  "fixConflictPrompt": "scripts/fix-conflict-prompt.md",
  "engines": {
    "default": "codex",
    "allowed": ["codex", "claude"]
  }
}
```

Implementation tasks:

- Replace `lib/paths.js` constants with a config loader.
- Replace hard-coded repo validation with configured repo keys.
- Replace role-by-repo defaults with configured role mappings.
- Make ticket ID validation prefix-aware but still allow custom IDs.
- Move status labels/columns into config while keeping current defaults.
- Bind the server to localhost by default and make host configurable.

## Phase 2: generic ticket system

Ship the board with a JSON Schema and a ticket CLI.

Core files to add:

- `schemas/ticket.schema.json`
- `schemas/index-row.schema.json`
- `bin/dev-board.mjs`
- `bin/new-ticket.mjs`
- `bin/validate-tickets.mjs`

Keep the current ticket shape as the default, but allow `custom` or `metadata`
for project-specific fields. The board should require only:

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
- `pr_url` or `pr_urls`
- `notes`

Nice first command set:

```bash
npx dev-board init
npx dev-board new-ticket --title "Add auth smoke test" --repo workspace --priority P1
npx dev-board validate
npx dev-board start
```

## Phase 3: agent skill pack

Include skills as templates that users can copy into `.codex/skills`,
`.claude/skills`, or a repo-local agent folder.

Recommended skills:

- `skills/create-ticket/SKILL.md`: turns a rough idea into a valid ticket,
  writes the JSON file, updates `_index.json`, and defaults AI-discovered work
  to `triage`.
- `skills/work-ticket/SKILL.md`: the autonomous working-session contract:
  read ticket/context, claim, implement, verify, commit, push, open PR, move to
  `human_review`, stop.
- `skills/fix-ci/SKILL.md`: inspect an existing PR/check failure, fix on the
  same branch, push, and never open a duplicate PR.
- `skills/fix-conflict/SKILL.md`: reuse the branch/worktree, resolve conflicts,
  push, and preserve the original PR.
- `skills/memory-bootstrap/SKILL.md`: create a lightweight project memory layer:
  `AGENTS.md`, a project manual, `memory/open-loops.md`,
  `memory/decisions/`, `memory/sync-queue/`, and primers.
- `skills/memory-sync/SKILL.md`: review session changes and propose memory
  updates through `memory/sync-queue/` instead of editing curated memory
  directly.
- `skills/board-doctor/SKILL.md`: diagnose CLI availability, git auth, ticket
  schema drift, stale worktrees, and unsafe arm/autopilot state.

The important design choice: skills should be product-neutral. They should say
"your project" and "human reviewer", not "Plander" or "Eric".

## Phase 4: launch engines as plugins

Today the code knows about Claude and Codex directly. For general use, define an
engine interface:

- `id`
- `label`
- `isAvailable()`
- `buildWorkArgs({ instruction, role, model, effort, cwd })`
- `buildFixArgs(...)`
- `readUsage()`
- `parseRunUsage(logText)`

Then ship built-in `claude` and `codex` engines, but let users disable either
one. This also opens the door to Gemini CLI, Aider, Goose, or custom scripts
without touching board logic.

## Phase 5: public UX polish

- Rename UI from "Plander Dev" to a neutral product name.
- Add first-run empty states for "no tickets yet" and "missing config".
- Add a Settings page for config paths, repos, engines, WIP limit, and memory
  queue.
- Add a Doctor page that explains launch blockers before a user arms the board.
- Preserve the cockpit feel, but remove project-specific labels and comments.
- Make all dangerous controls explicit: ARM, Autopilot, Stop, Resume, Fix CI.

## Phase 6: tests and release

- Add unit tests for config loading, ticket reads/writes, validation,
  dependency gating, branch naming, and engine arg construction.
- Add integration tests with temp directories for ticket movement and index
  rewrite.
- Add a fake engine for launch tests so CI never spawns real agent CLIs.
- Add GitHub Actions for lint/test.
- Publish as both a GitHub repo and an npm package with a `dev-board` binary.

## Generalizability gaps to solve before launch

- Multi-repo projects need configurable repo roots and base branches.
- Projects with non-GitHub remotes need a PR provider abstraction.
- Projects without PRs need an alternative "ready for review" handoff.
- Teams may want different statuses, priorities, and ticket prefixes.
- Ticket authors may want Markdown tickets instead of JSON; JSON should remain
  the first supported format because the board can validate it reliably.
- Usage tracking should be optional and provider-specific, never required for
  basic board operation.
- The board needs a dry-run mode that logs the exact command it would launch.
- The default launch command should be conservative; powerful flags should be
  opt-in and loudly visible.
- Private local paths, user names, logs, run ledgers, and OAuth/usage cache
  files must stay ignored.

## Suggested first public milestone

Ship a small but coherent v0.1:

- Configurable tickets directory, repos, statuses, and ID prefix.
- Generic README with setup, safety model, and screenshots.
- Ticket schema plus `new-ticket` and `validate` commands.
- Manual board operation works without any agent CLI.
- Optional agent launch works for one configured engine.
- Worktree isolation, WIP limit, disarmed default, and human review gate remain.
- Skills for `create-ticket`, `work-ticket`, and `memory-sync` included as
  templates.

That version is enough for people to try the workflow without inheriting the
whole Plander-specific operating system.
