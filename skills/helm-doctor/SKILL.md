---
name: helm-doctor
description: Diagnose HelmMate setup, ticket validity, config drift, engine availability, git/PR readiness, worktree state, and unsafe launch settings. Use when the user asks why the board cannot launch, wants a readiness check, wants onboarding validation, or wants to debug tickets/projects/agents.
---

# HelmMate Doctor

Use this as the readiness check after `helm-setup-project` finishes. Doctor
should verify setup and launch safety; it should not apply setup changes itself
unless the user explicitly asks.

Doctor answers one question: "Is HelmMate safe and ready for this repo?"

## Workflow

1. Read `helmmate.config.json`.
2. Run lightweight checks first when available:

```bash
npm run validate:tickets
node -e "import('./lib/paths.js').then(m=>console.log(JSON.stringify({active:m.CONFIG.activeProject, workspace:m.WORKSPACE_DIR, tickets:m.TICKETS_DIR, repos:m.REPO_KEYS, statuses:m.STATUSES}, null, 2)))"
```

3. Check setup and config:
   - config path exists and is the expected file
   - active project matches runtime project, or a restart is clearly required
   - workspace path exists
   - host binding is local (`127.0.0.1`, `localhost`, or another explicitly local-only bind)
4. Check local scaffold:
   - tickets directory exists
   - `_index.json` exists
   - tickets validate
   - configured repo paths exist
   - agent directory exists
   - memory queue directory exists
   - work prompt, CI prompt, and conflict prompt files exist when configured
   - persona/agent files exist when roles reference them
5. Check launch dependencies only when relevant:
   - `git`
   - configured engine binaries (`claude`, `codex`, or `opencode`)
   - `gh` for PR workflows
   - git auth/remotes sufficient for push/PR handoff
   - base branches exist locally or remotely
   - dirty worktrees
   - branch collisions
   - PR readiness for tickets already in `human_review`
6. Check process and worktree health:
   - worktree directory exists and entries map to known tickets/repos
   - WIP/running process state reconciles with `/api/state`, `/api/runs`, and live processes where possible
   - no stale in-progress tickets appear to be orphaned
7. Inspect board state through API if the server is running:
   - `/api/setup/status`
   - `/api/config`
   - `/api/state`
   - `/api/scheduler`
   - board armed/autopilot state is intentional for the user's current goal

## Classification

Use these buckets:

- **Blocker**: unsafe to arm or launch because a required path, repo, auth, base
  branch, engine, ticket index, validation, config/runtime match, or process
  invariant is broken.
- **Warning**: HelmMate can remain installed, but the user should understand the
  risk before arming. Examples: dirty worktree, autopilot already on, stale
  worktree, missing optional prompt/persona, unverified PR tooling, or server
  restart needed after a config switch.
- **Healthy**: checked and acceptable.

## Report Format

Lead with blockers, then warnings, then healthy checks. Include exact commands
or file paths for fixes. End with one of:

- `Safe to arm`
- `Safe to arm after reviewing warnings`
- `Blocked; do not arm yet`

## Safety

Stay read-only unless the user explicitly asks for fixes. Do not arm the board,
enable autopilot, edit tickets/config, delete worktrees, reset git state, switch
branches, push, create PRs, or kill sessions unless the user explicitly asks.
