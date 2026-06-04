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
-> edit/approve ticket -> preview launch -> optionally arm and run
```

## Product Principles

- **Existing repo first:** The primary onboarding path should be "connect my
  codebase", not "learn HelmMate config".
- **Preview before write:** Show what will change before writing config,
  tickets, prompts, folders, or worktrees.
- **No ambiguous execution states:** A ticket should not look "in progress"
  unless a session is actually running or the UI clearly says it did not launch.
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

V1 boundary:

- Preserve the existing status taxonomy.
- Focus on making failed launch intent visually honest.
- Do not introduce a new `queued` status in V1.

V1 plan:

- If a user tries to move a ticket to `in_progress` while the board is disarmed,
  do not persist `in_progress`.
- Leave the ticket in its original status and show a clear toast/panel message:
  "Board is disarmed. Ticket was not launched."
- For WIP limit, also avoid persisting `in_progress`; add a note or visible
  message that the ticket could not launch because WIP is full.
- Keep `blocked` only for ticket problems, unmet dependencies, and preflight
  failure.
- Only set `in_progress` after a process is launched and recorded in WIP.

Later work:

- Add a first-class `queued` state only for launch blockers that may clear
  without ticket edits, such as disarmed board or WIP limit.
- Add scheduler-managed queue semantics.

Likely files:

- `public/board.js`
- `lib/launcher.js`
- `server.js`

Acceptance criteria:

- Moving a ticket toward execution while disarmed does not leave it looking like
  actively running work.
- WIP count, ticket status, card badge, toast, and live log agree.
- The side panel explains why the ticket did not launch and how to proceed.
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

Create a simple UI handoff that helps the user ask their existing coding agent
to run HelmMate's setup skill.

V1 boundary:

- The UI is not responsible for full repo inspection, package-manager
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
- existing `helmmate.config.json`;
- existing `tickets/`, `.agents/`, `memory/sync-queue/`;
- prompt files present/missing.

Minimal UI/API shape:

```text
POST /api/setup/agent-prompt
GET /api/setup/status
```

Later API shape:

```text
POST /api/setup/inspect-repo
POST /api/setup/preview-project
```

V1 excludes `POST /api/setup/apply-project`; setup writes should happen through
the user's coding agent and the `helm-setup-project` skill.

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

Later work:

- Native repo inspection in the UI.
- Native config diff preview.
- Native one-click setup agent run.
- File picker integration.

### Session 4: Ticket Creation And Editing In The UI

Objective:

Let users review and improve AI-generated tickets without editing JSON by hand.

V1 boundary:

- V1 should edit only the fields that most affect whether an agent can do useful
  work.

V1 UI support:

- create ticket;
- edit title;
- edit description;
- edit acceptance criteria;
- edit context refs;
- edit priority, status, and repo;
- add reviewer notes;
- validate before save.

Later work:

- dependency picker and dependency graph validation;
- branch editing;
- PR URL / review handoff editing;
- role/persona editing;
- full JSON editor;
- bulk editing.

Recommended pattern:

- Keep the side panel as the review surface.
- Add an `Edit` mode with explicit `Save` and `Cancel`.
- Validate on save and show field-level errors.
- Keep JSON as canonical storage.
- Use existing `PATCH /api/tickets/:id` where possible before inventing a large
  new ticket-update API.

Likely files:

- `public/board.js`
- `public/board.css`
- `server.js`
- `lib/tickets.js`
- `lib/validation.js`

Acceptance criteria:

- A user can create a useful triage/backlog ticket from the Board.
- A user can fix missing acceptance criteria from the side panel.
- `_index.json` stays in sync after edits.
- Ticket validation passes after UI edits.

### Session 5: Launch Preview

Objective:

Give the user a clear, auditable preview before any agent process starts.

V1 boundary:

- V1 should be a read-only launch preview that explains what would happen using
  the same helpers where easy, without spawning anything.

V1 add:

- `Launch preview` section or button on ticket panel.
- Launch preview section:
  - engine;
  - model/effort;
  - role/persona;
  - command summary, not necessarily every argv token;
  - cwd;
  - branch;
  - worktree path/mode;
  - prompt file;
  - expected handoff status;
  - blockers/warnings.

V1 API shape:

```text
GET /api/tickets/:id/launch-preview
```

Implementation notes:

- V1 excludes `POST /api/tickets/:id/dry-run`.
- The preview must not spawn an agent.
- It is acceptable for V1 to preview a redacted/summary command if exact argv
  extraction would require risky refactoring.
- Prefer reusing `resolveEngine`, role/model helpers, path config, and existing
  preflight checks.

Likely files:

- `lib/engine.js`
- new `lib/launch-preview.js`
- `server.js`
- `public/board.js`
- `public/board.css`

Acceptance criteria:

- Preview never spawns an agent.
- Preview explains the same engine/role/model/path choices the launcher would
  use.
- Missing CLIs/prompt files/persona files appear as warnings before launch.
- User can copy preview details for debugging.

Later work:

- exact argv parity with launch;
- command-builder refactor;
- fake engine for launch tests;
- full dry-run log ledger.

### Session 6: Doctor / Readiness Page

Objective:

Create a single place that answers "is HelmMate safe and ready for this repo?"

V1 boundary:

- V1 should combine a lightweight UI checklist with a copyable `helm-doctor`
  prompt, mirroring the setup-handoff approach.

V1 checks in UI:

- setup status from `/api/setup/status`;
- config path;
- active project/runtime project mismatch;
- restart needed;
- ticket directory/index exist;
- configured repos exist by key, if available from current APIs;
- board armed/autopilot state;
- ticket validation command shown as a suggested check.

V1 agent handoff:

- Add a "Run Doctor with your coding agent" prompt that routes through
  `helm-doctor`.
- The skill does deeper checks: git auth, CLI availability, dirty worktrees,
  prompt files, persona files, branch collisions, PR readiness, and process
  reconciliation.

Full native checks for later:

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
- `public/home.js`
- `public/projects.js`
- `lib/setup-agent.js` or a new prompt builder
- `skills/helm-doctor/SKILL.md`
- CSS files for shared status rows

Acceptance criteria:

- The user can see basic readiness before arming the board.
- The user can copy a high-quality Doctor prompt.
- The Doctor prompt works even when slash commands are unavailable.
- The skill distinguishes blockers from warnings and stays read-only unless the
  user explicitly asks for fixes.

Later work:

- `GET /api/doctor`;
- dedicated Doctor page;
- process reconciliation UI;
- automatic CLI/git/PR probing from the server.

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

- Before runs exist: readiness checklist + next actions, using existing APIs
  first.
- After runs exist: current ops dashboard.
- Usage cards should be secondary when the selected/default engine does not need
  that provider.

Likely files:

- `public/home.js`
- `public/home.css`
- existing `/api/setup/status`, `/api/config`, `/api/state`, `/api/scheduler`

Acceptance criteria:

- Fresh install Home does not look broken.
- Usage endpoint failures are quiet unless they block the selected engine.
- User sees a clear next step based on current readiness.

Later work:

- new lifecycle-state backend API;
- custom dashboard layouts;
- provider-specific usage setup wizard.

### Session 8: Agent Setup Surface

Objective:

Turn Agents into a pre-run trust surface as well as a post-run accounting page.

V1 boundary:

- V1 should be read-only and explanatory.

V1 add:

- default engine explanation;
- role-to-repo mapping;
- persona file preview/status;
- model/effort defaults;
- prompt file status;
- permission/sandbox warning;
- logs and memory proposal locations.

Later work:

- engine availability probing;
- editing roles/personas from this surface;
- custom engine command configuration;
- prompt file creation from the UI.

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
- No new write actions are introduced in V1.

### Session 9: Migration Imports

Objective:

Create paths from existing work into HelmMate tickets.

V1 boundary:

- Native imports from files, GitHub, Linear, branches, and docs are each their
  own product surface.
- V1 should be skill-first, not parser-first.

Start with agent-assisted local imports before external connectors:

- paste rough notes;
- optionally point the agent at Markdown/TODO/roadmap files;
- ask the agent to use `helm-create-ticket`;
- let the user review resulting JSON tickets on the Board.

Later imports:

- native Markdown file import;
- TODO/doc scanning;
- open branches as review tickets;
- GitHub issues;
- Linear issues;
- GitHub PRs;
- existing JSON/Markdown ticket files.

Recommended first version:

- `Import from notes` handoff.
- User pastes text.
- UI generates a prompt that routes the user's coding agent through
  `helm-create-ticket`.
- Agent writes one or more `triage` tickets.
- User reviews generated tickets on the Board.

Likely files:

- `public/board.js`
- `public/projects.js`
- skills under `skills/helm-create-ticket`
- `lib/setup-agent.js` or a new prompt builder

Acceptance criteria:

- User can copy a high-quality prompt that turns pasted notes into one or more
  triage tickets.
- `helm-create-ticket` previews proposed tickets for bulk/import work unless
  the user explicitly asked it to create tickets immediately.
- Generated tickets validate.
- User can review/edit generated triage tickets on the Board before launching
  anything.

Later work:

- native note parser;
- preview-before-write inside HelmMate UI;
- external connectors;
- Markdown ticket import/export.

## Suggested Order

Do these first:

1. Session 1: execution-state trust.
2. Session 2: empty Board actions.
3. Session 3: lightweight repo setup handoff.
4. Session 4: minimal ticket creation/editing.
5. Session 5: launch preview.

Then:

6. Session 6: lightweight Doctor handoff/readiness.
7. Session 7: readiness Home.
8. Session 8: read-only agent setup surface.
9. Session 9: skill-assisted imports.

Rationale:

- Fixing status ambiguity protects user trust immediately.
- Empty states and setup handoff reduce first-run friction quickly.
- Ticket editing and launch preview make the first real agent run feel safer.
- Doctor, Home, Agents, and imports should follow the same pattern: lightweight
  UI first, skill-assisted depth later.

## Cross-Cutting UX Copy

Use plain, reassuring labels:

- "Connect existing repo" instead of "Import repo defaults".
- "Preview setup" before "Save project".
- "Not launched" when disarmed or WIP-limited.
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
2. Generate a setup handoff prompt for an existing repo without editing JSON.
3. Ask their coding agent to run `helm-setup-project` and see what changed.
4. Keep the board disarmed throughout setup.
5. Create or import a useful first ticket.
6. Edit the ticket into launch-ready shape.
7. Run or copy a Doctor/readiness check and understand any blockers.
8. Preview launch routing before starting an agent.
9. Arm and launch only after an explicit decision.
10. Review logs, branch, PR, and handoff from the ticket panel.
