---
name: helm-doctor
description: Diagnose HelmMate setup, ticket validity, config drift, engine availability, git/PR readiness, worktree state, and unsafe launch settings. Use when the user asks why the board cannot launch, wants a readiness check, wants onboarding validation, or wants to debug tickets/projects/agents.
---

# HelmMate Doctor

## Workflow

1. Read `devboard.config.json`.
2. Run lightweight checks first:

```bash
npm run validate:tickets
node -e "import('./lib/paths.js').then(m=>console.log(JSON.stringify({active:m.CONFIG.activeProject, workspace:m.WORKSPACE_DIR, tickets:m.TICKETS_DIR, repos:m.REPO_KEYS, statuses:m.STATUSES}, null, 2)))"
```

3. Check local scaffold:
   - tickets directory exists
   - `_index.json` exists
   - configured repo paths exist
   - agent directory exists
   - memory queue directory exists
4. Check launch dependencies only when relevant:
   - configured engine binaries
   - `git`
   - `gh` for PR workflows
   - dirty worktrees
   - branch collisions
5. Inspect board state through API if the server is running:
   - `/api/setup/status`
   - `/api/config`
   - `/api/state`
   - `/api/scheduler`

## Report Format

Lead with blockers, then warnings, then healthy checks. Include exact commands or file paths for fixes.

## Safety

Do not arm the board, enable autopilot, delete worktrees, reset git state, or kill sessions unless the user explicitly asks.
