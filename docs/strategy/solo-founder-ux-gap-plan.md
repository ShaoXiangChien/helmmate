# Solo Founder UX Gap Plan

Date: 2026-06-03

## Goal

Make HelmMate feel safe and low-friction for a solo founder or engineer who
already has a codebase, often with AI-written changes they need to review.

The product should prove, within the first few minutes, that it can attach to an
existing repo without taking over the project, launching surprise agents, or
forcing the user to rewrite their workflow.

Target first-session outcome:

```text
choose repo -> inspect setup -> review proposed config/tickets -> stay disarmed
-> edit/approve ticket -> dry-run launch -> optionally arm and run
```

## Product Principles

- **Existing repo first:** The primary onboarding path should be "connect my
  codebase", not "learn HelmMate config".
- **Preview before write:** Show what will change before writing config,
  tickets, prompts, folders, or worktrees.
- **No ambiguous execution states:** A ticket should not look "in progress"
  unless a session is actually running, or the UI clearly labels it as queued.
- **Human review is the product:** The interface should help the user inspect,
  edit, and approve AI work, not only launch it.
- **Agent setup is delegable but auditable:** Generated setup prompts should say
  what the agent may inspect, what it may write, how to validate, and how to
  undo or restart.
- **Ops dashboard comes after readiness:** Usage, spend, CI, and autopilot are
  valuable after setup; before setup, readiness and safety should dominate.

## Current Gaps

### 1. Existing Repo Setup Is Too Abstract

The Projects page asks for generic project fields, then saves generic defaults.
For the target user, "Import existing repo" should inspect the repo and explain
what HelmMate learned.

Current behavior:

- `Import existing repo` writes a generic project payload.
- Repo key is always `workspace`.
- Worktree mode defaults to `false`.
- Base branch defaults to `main`.
- There is no repo inspection, preview, validation, or undo guidance.

Impact:

- The user cannot tell whether HelmMate understands their repo.
- The user cannot tell what files will be created.
- The phrase "import" over-promises.

### 2. Empty Board Is A Dead End

With no tickets, the Board shows empty columns and no next action.

Impact:

- A new user sees the core surface but gets no help creating, importing, or
  generating the first useful ticket.
- The product feels configured for an existing internal workflow, not a fresh
  install.

### 3. Disarmed Launch State Is Ambiguous

Moving a ticket to `in_progress` while the board is disarmed changes the ticket
status to `in_progress`, but no session starts. The toast says queued and WIP
stays `0/2`.

Impact:

- The board says work is happening when no process is running.
- This undermines the safety model at the exact moment the user is testing it.

### 4. Ticket Review Is Read-Only

The ticket side panel exposes useful review data, but most ticket fields cannot
be edited in the UI.

Missing edits:

- title
- description
- acceptance criteria
- dependencies
- context refs
- branch
- PR URL / review handoff notes
- priority
- repo
- role / agent persona

Impact:

- Users cannot sharpen AI-generated tickets before launching work.
- Users must edit JSON manually, which raises friction and error risk.

### 5. Setup Prompt Needs More Trust-Building

The copied setup prompt is useful but generic.

Missing trust signals:

- what files/folders may be created;
- whether existing project entries are preserved;
- how repo facts are detected;
- whether worktrees will be used;
- what command validates setup;
- whether restart is required;
- what to do if the agent made wrong assumptions.

### 6. Home Is Ops-First During First Run

Home emphasizes usage limits, dispatch, spend, CI watch, and unavailable usage
data. That is useful later, but first-run users need readiness.

Impact:

- "Usage unavailable" can feel like "the app is broken".
- The user does not get a simple answer to "am I ready to run this safely?"

### 7. Agents Tab Is Not Agent Setup

Agents currently reads as memory/spend accounting. Before running work, a user
needs to understand the agent contract.

Missing setup/readiness details:

- which engine will run;
- exact command preview;
- current model/effort defaults;
- persona files found/missing;
- prompt files found/missing;
- permissions/sandbox posture;
- where logs and PR handoff will appear.

### 8. Migration Has No Import Sources

There is no first-class path from existing project material into tickets.

Likely sources:

- GitHub issues;
- Linear issues;
- Markdown TODOs;
- `README.md`, `docs/`, `TODO.md`, `ROADMAP.md`;
- open PRs or branches with AI-written work;
- pasted rough notes.

## Implementation Plan By Session

### Session 1: Fix Execution-State Trust

Objective:

Make it impossible for a ticket to look actively running when no agent session
exists.

Decisions to make:

- Add a real `queued` status, or keep statuses unchanged and prevent moving to
  `in_progress` while disarmed/WIP-blocked.
- Decide whether "queued because disarmed" belongs in `backlog`, `triage`, or a
  separate visual state.

Recommended path:

- Add a first-class `queued` state only for launch blockers that may clear
  without ticket edits, such as disarmed board or WIP limit.
- Keep `blocked` for ticket problems, unmet dependencies, and preflight failure.
- Do not set `in_progress` until a process is launched and recorded in WIP.

Likely files:

- `public/board.js`
- `lib/launcher.js`
- `lib/scheduler.js`
- `devboard.config.json`
- `README.md`
- `schemas/ticket.schema.json`

Acceptance criteria:

- Moving a ticket toward execution while disarmed does not leave it looking like
  actively running work.
- WIP count, ticket status, card badge, toast, and live log agree.
- The side panel explains why the ticket is queued and how to proceed.
- Ticket validation passes.

Test cases:

- Disarmed board + move to execution.
- Armed board + WIP slot available.
- Armed board + WIP full.
- Dependency failure.
- Preflight failure.

### Session 2: Board Empty States And First Useful Actions [DONE 2026-06-03]

Objective:

Make the empty Board guide users toward setup, ticket creation, and import.

Recommended changes:

- Add an empty state for zero tickets.
- Add per-column empty hints only when useful.
- Add Board-level actions:
  - `Connect existing repo`
  - `Create ticket`
  - `Import from notes`
  - `Copy setup prompt`
  - `Run doctor`

Likely files:

- `public/board.js`
- `public/board.css`
- `public/projects.js`
- `public/onboarding.js`

Acceptance criteria:

- A fresh install with zero tickets has an obvious next action on the Board.
- The user can reach Projects/setup without hunting through the sidebar.
- Empty states do not crowd boards that already have tickets.

Completion notes:

- Added a zero-ticket Board empty state with actions for repo setup, starter
  ticket creation, setup prompt copy, notes import placeholder, and Doctor
  placeholder.
- Added lightweight per-column hints only when tickets exist but a specific
  column is empty.
- Implemented the flow in both the React/Vite UI and the static Board entry.

### Session 3: Lightweight Repo Setup Handoff

Objective:

Replace the over-scoped "repo setup wizard" with a simple UI handoff that helps
the user ask their existing coding agent to run HelmMate's setup skill.

Important scope correction:

- Do not make the UI responsible for full repo inspection, package-manager
  detection, git analysis, or config diffing yet.
- The UI should collect enough intent to create a high-quality agent prompt.
- The user's Claude Code, Codex, or other coding agent should run
  `helm-setup-project` and do the actual repository inspection/config update.

Recommended UI flow:

1. User enters:
   - project ID;
   - project name;
   - workspace path;
   - ticket prefix;
   - preferred engine, if known.
2. UI shows a "Use your coding agent" card.
3. UI generates a copyable prompt that says:
   - run `/helm-setup-project` if available;
   - otherwise use the `helm-setup-project` skill directly;
   - otherwise read `skills/helm-setup-project/SKILL.md`;
   - inspect the target workspace read-only before editing;
   - preview intended config/folder changes;
   - preserve unrelated project entries;
   - initialize local folders;
   - validate tickets;
   - never arm HelmMate or enable autopilot.
4. User pastes the prompt into Claude Code, Codex, or another local coding
   agent.
5. Agent performs setup in the repo using the skill.
6. UI offers a refresh/checklist after the user returns.

What the setup skill should inspect:

- git root;
- current branch;
- default branch guess;
- remote URL/provider;
- package manager;
- likely test command;
- repo name;
- dirty working tree;
- existing `devboard.config.json`;
- existing `tickets/`, `.agents/`, `memory/sync-queue/`;
- prompt files present/missing.

Minimal UI/API shape:

```text
POST /api/setup/agent-prompt
GET /api/setup/status
```

Optional later API shape, only after the skill-led flow works:

```text
POST /api/setup/inspect-repo
POST /api/setup/preview-project
```

Do not add `POST /api/setup/apply-project` until there is a strong reason for
the UI itself to write project config.

Skill work:

- Strengthen `skills/helm-setup-project/SKILL.md` so it is a complete handoff
  contract for external coding agents.
- Make the generated setup prompt include the exact user inputs and safety
  requirements.
- Keep `helm-doctor` as the follow-up readiness check after setup.

Safety requirements for this session:

- UI prompt generation is safe and side-effect free.
- The setup skill must preview intended changes before editing.
- Do not arm the board.
- Do not enable autopilot.
- Do not delete tickets, reset git state, remove worktrees, or switch branches
  unless the user explicitly asks.

Likely files:

- `lib/setup-agent.js`
- `public/projects.js`
- `public/board.js`
- `public/home.js` if setup handoff appears in readiness cards
- `skills/helm-setup-project/SKILL.md`
- `skills/helm-doctor/SKILL.md`
- `docs/strategy/agent-assisted-setup.md`

Acceptance criteria:

- User can generate a high-quality setup prompt from the UI.
- The prompt is understandable even if the user's agent does not have slash
  commands installed.
- The prompt names the exact skill file fallback path.
- The prompt tells the agent to inspect read-only first, preview changes, and
  keep HelmMate disarmed.
- `helm-setup-project` contains enough detail for Codex/Claude to onboard a repo
  without the UI implementing inspection itself.
- After the user returns, the UI can refresh setup status and explain whether a
  restart is needed.

Deferred:

- Native repo inspection in the UI.
- Native config diff preview.
- Native one-click setup agent run.
- File picker integration.

### Session 4: Ticket Creation And Editing In The UI

Objective:

Let users review and improve AI-generated tickets without editing JSON by hand.

Add UI support for:

- create ticket;
- edit title;
- edit description;
- edit acceptance criteria;
- edit context refs;
- edit dependencies;
- edit priority/status/repo;
- edit branch;
- edit PR URL or review handoff;
- add reviewer notes;
- validate before save.

Recommended pattern:

- Keep the side panel as the review surface.
- Add an `Edit` mode with explicit `Save` and `Cancel`.
- Validate on save and show field-level errors.
- Keep JSON as canonical storage.

Likely files:

- `public/board.js`
- `public/board.css`
- `server.js`
- `lib/tickets.js`
- `lib/validation.js`
- `schemas/ticket.schema.json`

Acceptance criteria:

- A user can create a launch-ready ticket from the Board.
- A user can fix missing acceptance criteria from the side panel.
- Invalid dependency IDs are clearly flagged.
- `_index.json` stays in sync after edits.
- Ticket validation passes after UI edits.

### Session 5: Launch Preview And Dry Run

Objective:

Give the user a clear, auditable preview before any agent process starts.

Add:

- `Dry run` action on ticket panel.
- Launch preview section:
  - engine;
  - model/effort;
  - role/persona;
  - exact command shape;
  - cwd;
  - branch;
  - worktree path/mode;
  - prompt file;
  - expected handoff status;
  - blockers/warnings.

API shape:

```text
GET /api/tickets/:id/launch-preview
POST /api/tickets/:id/dry-run
```

Implementation note:

Extract command construction from `launchTicket()` so preview and real launch
share the same source of truth.

Likely files:

- `lib/launcher.js`
- `lib/engine.js`
- new `lib/launch-preview.js`
- `server.js`
- `public/board.js`
- `public/board.css`

Acceptance criteria:

- Dry run never spawns an agent.
- Preview matches the command path used by real launch.
- Missing CLIs/prompt files/persona files appear as warnings before launch.
- User can copy preview details for debugging.

### Session 6: Doctor / Readiness Page

Objective:

Create a single place that answers "is HelmMate safe and ready for this repo?"

Checks:

- config path;
- active project vs runtime project;
- restart needed;
- workspace path exists;
- git repo detected;
- dirty working tree;
- base branch exists;
- ticket directory/index exist;
- tickets validate;
- agent CLI availability;
- Codex/Claude config availability where relevant;
- prompt files exist;
- persona files exist;
- worktree directory health;
- host binding is local;
- board armed/autopilot state;
- WIP/running process reconciliation.

Likely files:

- `server.js`
- new `lib/doctor.js`
- `public/home.js`
- new `public/doctor.js` or integrate into Home/Projects
- CSS files for shared status rows

Acceptance criteria:

- The user can run Doctor before arming the board.
- Doctor distinguishes warnings from blockers.
- Every blocker has a suggested next action.
- Doctor does not mutate project files.

### Session 7: Reframe Home For First-Run Readiness

Objective:

Make Home adapt to the lifecycle stage of the user.

Lifecycle states:

- no project configured;
- project configured but folders missing;
- folders ready but no tickets;
- tickets exist but none launch-ready;
- launch-ready tickets exist;
- runs active/recent.

Recommended Home layout:

- Before runs exist: readiness checklist + next actions.
- After runs exist: current ops dashboard.
- Usage cards should be secondary when the selected/default engine does not need
  that provider.

Likely files:

- `public/home.js`
- `public/home.css`
- `server.js`
- `lib/state.js`
- setup/doctor APIs

Acceptance criteria:

- Fresh install Home does not look broken.
- Usage endpoint failures are quiet unless they block the selected engine.
- User sees a clear next step based on current readiness.

### Session 8: Agent Setup Surface

Objective:

Turn Agents into a pre-run trust surface as well as a post-run accounting page.

Add:

- engine availability;
- default engine explanation;
- role-to-repo mapping;
- persona file preview/status;
- model/effort defaults;
- prompt file status;
- permission/sandbox warning;
- logs and memory proposal locations.

Likely files:

- `public/agents.js`
- `public/agents.css`
- `server.js`
- `lib/agents-config.js`
- `lib/roles.js`
- `lib/engine.js`

Acceptance criteria:

- User can understand what "cross-repo", "architect", or repo-specific roles
  mean before launching.
- Missing persona/prompt files are visible.
- Engine/model routing can be reviewed without opening JSON.

### Session 9: Migration Imports

Objective:

Create paths from existing work into HelmMate tickets.

Start with local imports before external connectors:

- paste rough notes;
- import Markdown file;
- scan TODO-style files;
- generate tickets from README/roadmap docs;
- import open branches as review tickets.

Later imports:

- GitHub issues;
- Linear issues;
- GitHub PRs;
- existing JSON/Markdown ticket files.

Recommended first version:

- `Import from notes` modal.
- User pastes text.
- Agent/setup prompt turns notes into valid tickets.
- User reviews generated tickets before writing.

Likely files:

- `server.js`
- `lib/tickets.js`
- new `lib/imports.js`
- `public/board.js`
- `public/projects.js`
- skills under `skills/helm-create-ticket`

Acceptance criteria:

- User can turn pasted notes into one or more draft tickets.
- No ticket is written without preview.
- Generated tickets validate.
- User can edit before save.

## Suggested Order

Do these first:

1. Session 1: execution-state trust.
2. Session 2: empty Board actions.
3. Session 4: ticket editing.
4. Session 3: existing repo wizard.
5. Session 5: dry run.

Then:

6. Session 6: Doctor.
7. Session 7: readiness Home.
8. Session 8: agent setup surface.
9. Session 9: imports.

Rationale:

- Fixing status ambiguity protects user trust immediately.
- Empty states and editing reduce first-run friction quickly.
- The repo wizard and dry run are the biggest adoption unlocks, but they are
  cleaner once execution states and ticket editing are stable.

## Cross-Cutting UX Copy

Use plain, reassuring labels:

- "Connect existing repo" instead of "Import repo defaults".
- "Preview setup" before "Save project".
- "Queued, not running" when disarmed or WIP-limited.
- "Ready to launch" only when dependencies, repo, prompt, and ticket shape pass.
- "Dry run" for command preview.
- "Doctor" or "Readiness" for environment checks.

Avoid copy that implies hidden automation:

- "Import" when no inspection happens.
- "In progress" when no process exists.
- "Autopilot" as a primary setup concept.
- Provider-specific usage errors before the user has chosen that provider.

## Definition Of Done For The Adoption Push

The gap work is done when a new solo-founder user can:

1. Start HelmMate locally.
2. Connect an existing repo without editing JSON.
3. See exactly what HelmMate will create or change.
4. Keep the board disarmed throughout setup.
5. Create or import a useful first ticket.
6. Edit the ticket into launch-ready shape.
7. Run Doctor and understand any blockers.
8. Dry-run the launch command.
9. Arm and launch only after an explicit decision.
10. Review logs, branch, PR, and handoff from the ticket panel.
