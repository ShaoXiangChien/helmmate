---
name: helm-work-ticket
description: Work a HelmMate ticket end to end through implementation, verification, commit/PR preparation, and human-review handoff. Use when an agent is assigned a specific HelmMate ticket JSON file or ticket id to implement.
---

# HelmMate Work Ticket

## Contract

Work exactly one ticket. Do not expand scope unless needed to satisfy acceptance criteria. End in `human_review`, not `done`.

## Workflow

1. Read `helmmate.config.json`, the target ticket JSON, and all listed `context_refs`.
2. Confirm dependencies in `depends_on` are done. If not, add a note and stop.
3. Inspect the repo state with `git status --short`. Do not overwrite unrelated user changes.
4. Use the ticket branch if present; otherwise create `ticket/<id>-<short-title>`.
5. Implement the smallest complete change that satisfies the ticket.
6. Run focused verification. Prefer project test scripts; otherwise run the narrowest useful command.
7. Update the ticket:
   - `branch`
   - `pr_url` or `pr_urls` when available
   - `status: "human_review"`
   - `updated`
   - `notes` with verification summary
8. Commit and push if the repository is configured for PR handoff and credentials are available.
9. Open or prepare a PR. Never merge it.

## Failure Handling

If blocked, set `status: "blocked"` and add a note explaining the blocker and next human action. If verification cannot run, leave a note with the exact reason.

## Safety

Do not enable ARM/autopilot. Do not create duplicate PRs for an existing branch. Do not mark `done`; that belongs to the human review/merge gate.
