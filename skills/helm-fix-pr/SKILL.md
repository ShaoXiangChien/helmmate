---
name: helm-fix-pr
description: Fix an existing HelmMate ticket PR with failing CI, merge conflicts, or review-blocking regressions. Use when the user asks to fix CI, resolve conflicts, repair a human_review ticket, or continue work on an existing ticket branch without opening a duplicate PR.
---

# HelmMate Fix PR

## Workflow

1. Read the ticket JSON and identify `pr_url` or the relevant entry in `pr_urls`.
2. Inspect the existing branch and PR state. Prefer `gh pr view` and `gh pr checks` when GitHub CLI is available.
3. Reuse the existing branch/worktree. Do not create a new branch unless the original branch is missing and the user approves.
4. For CI failures, read failing check logs before editing.
5. For conflicts, merge or rebase the configured base branch according to local repo conventions.
6. Make the minimal fix, run focused verification, commit, and push to the same branch.
7. Update ticket `notes` with what failed, what changed, and what verification ran.
8. Keep the ticket in `human_review`.

## PR Rules

- Never open a duplicate PR for the same ticket.
- Never merge the PR.
- Preserve existing PR URL fields.
- If several PRs exist, fix only the specified PR unless the user asks for all.

## Blockers

If auth, missing remotes, unavailable check logs, or unresolved conflicts prevent progress, record the blocker in ticket notes and stop.
