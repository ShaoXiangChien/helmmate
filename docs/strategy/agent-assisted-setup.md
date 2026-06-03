# Agent-Assisted Setup

Date: 2026-06-02

## Goal

Reduce manual HelmMate setup until a new user only has to choose a project flow and
confirm agent-generated changes.

The current project config editor is useful for power users, but it should not
be the primary onboarding path.

## Setup Flows

### Existing Repo

Use when the user already has a repository and wants HelmMate to manage tickets and
agent launches for it.

Inputs:

- project ID
- project name
- workspace path
- ticket prefix
- preferred engine

Agent work:

- inspect the repo;
- create or update `devboard.config.json`;
- add `projects.<id>`;
- keep unrelated projects intact;
- initialize `tickets/`, `.agents/`, and `memory/sync-queue/`;
- run `npm run validate:tickets`;
- leave HelmMate disarmed.

### New Project

Use when the user is creating a fresh repository.

Inputs:

- project ID
- project name
- workspace path
- ticket prefix
- preferred engine

Agent work:

- wait until the repo scaffold exists;
- write the HelmMate project config;
- initialize local folders;
- optionally create one starter ticket;
- validate tickets;
- leave HelmMate disarmed.

### Multi-Project Workspace

Use when HelmMate already has one project and the user wants to add another.

Agent work:

- add a new `projects.<id>` entry;
- preserve `activeProject` unless the user explicitly asks to switch;
- explain that switching active project currently requires a server restart.

## Skill Usage

Primary skill:

- `skills/helm-setup-project/SKILL.md`

The UI should generate prompts that say:

- run `/helm-setup-project` if available;
- use `helm-setup-project` directly if slash commands are not available;
- otherwise read the local `SKILL.md`;
- preserve unrelated config;
- validate tickets;
- never arm HelmMate or enable autopilot during setup.

## UI Direction

Projects should have three first-class actions:

- Import existing repo
- Save new project defaults
- Copy setup prompt

The advanced config editor remains available, but it should be collapsed by
default.

The near-term UI should not try to fully inspect and configure arbitrary repos
by itself. Instead, it should collect a few intent fields and generate a strong
handoff prompt for the user's existing coding agent:

```text
Project ID
Project name
Workspace path
Ticket prefix
Preferred engine
```

The prompt should route the agent through `helm-setup-project`, with fallbacks:

1. run `/helm-setup-project` if slash commands are available;
2. use the `helm-setup-project` skill directly if installed;
3. otherwise read `skills/helm-setup-project/SKILL.md` from the HelmMate repo.

That skill, not the UI, should inspect git state, package manager, prompt files,
folders, and config preservation requirements. After the user runs the agent,
the UI can refresh setup status and point to Doctor/readiness checks.

## Future One-Click Agent Run

When we are ready to execute setup from the UI, add a guarded endpoint:

```text
POST /api/setup/agent-run
```

Body:

```json
{
  "engine": "codex",
  "mode": "existing",
  "projectId": "example",
  "name": "Example",
  "workspaceDir": "/path/to/repo",
  "ticketIdPrefix": "EX"
}
```

Safety requirements:

- show the exact generated prompt before launch;
- require an explicit user click;
- do not require ARM, because setup is not ticket execution;
- write logs to a setup-specific log file;
- block public host binding;
- never enable autopilot;
- surface changed files after the run;
- ask the user to restart when active project changes.

The endpoint can reuse the prompt builder behind:

```text
POST /api/setup/agent-prompt
```

## Why This Matters

HelmMate's target users are engineers and technical PMs. They will tolerate config
when they need precision, but onboarding should feel like delegation:

1. choose a flow;
2. let the agent inspect the repo;
3. review generated config and starter tickets;
4. start steering work from the board.
