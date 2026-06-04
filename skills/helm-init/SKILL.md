---
name: helm-init
description: Initialize a fresh project workspace and register it with HelmMate. Use when the user does not have an existing project yet, wants an agent to create a small starter scaffold, infer HelmMate defaults, add the project to helmmate.config.json, initialize tickets and support folders, and keep the board disarmed.
---

# HelmMate Init

Use this skill when the user has not created the target project yet. This is a
thin new-project entrypoint for `helm-setup-project`; follow that skill's safety
rules, config rules, validation steps, and final report requirements.

## Safety

- Preview the intended project folder, stack, and HelmMate config changes before
  editing.
- Ask at most one clarifying question only if the project stack or target folder
  cannot be inferred safely.
- Never arm HelmMate.
- Never enable autopilot.
- Do not delete tickets, reset git state, switch branches, push, or create PRs.
- Preserve unrelated `helmmate.config.json` project entries and top-level
  defaults.

## New Project Defaults

Infer these values instead of asking the user to type them:

- Project ID: stable slug from the folder or project name.
- Ticket prefix: short uppercase prefix from the project name, avoiding obvious
  collisions with existing projects.
- Repo key: `workspace` for a simple single-repo project.
- Tickets directory: `tickets`.
- Agent directory: `.agents`.
- Memory queue: `memory/sync-queue`.
- Statuses: HelmMate's standard status list.
- Worktrees: disabled for the first conservative setup.

## Workflow

1. Identify the HelmMate repository and the intended target project folder.
2. If the target folder is empty or missing, preview the smallest useful scaffold
   for the user's requested stack. If no stack was requested, create only a
   minimal README and HelmMate support scaffold after preview.
3. Inspect the resulting workspace read-only: git state, package manager, likely
   test command, repo name, branch, remote, and existing HelmMate files.
4. Add or update the project entry in HelmMate's `helmmate.config.json`.
5. Set the new project active unless the user is clearly managing multiple
   projects manually.
6. Initialize HelmMate support folders with `npm run init` from the HelmMate
   repository, or `node bin/helmmate.mjs init` if npm scripts are unavailable.
7. Run `npm run validate:tickets` or `node bin/validate-tickets.mjs`.
8. Recommend `helm-doctor` as the next check.

## Final Report

Finish with the created folder, inferred project ID and ticket prefix, what was
created, what was registered in HelmMate, validation results, whether the
HelmMate server needs a restart, and any assumptions.
