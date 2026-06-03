---
name: helm-create-ticket
description: Turn a rough idea, bug report, user request, open loop, or implementation note into a valid HelmMate JSON ticket. Use when the user asks to create/write/add/triage a ticket, convert notes into board work, or seed tickets during onboarding.
---

# HelmMate Create Ticket

## Workflow

1. Read `devboard.config.json` to identify `ticketsDir`, `ticketIdPrefix`, configured repos, and statuses.
2. Clarify only if the target repo or desired outcome is ambiguous enough to create bad work. Otherwise choose the configured `workspace` repo or first repo.
3. Create the ticket through the CLI when possible:

```bash
node bin/new-ticket.mjs --title "<title>" --repo <repo> --priority P2
```

4. Edit the generated JSON file to add meaningful details.
5. Run `npm run validate:tickets`.

## Notes / Import Mode

When converting pasted notes, roadmap text, TODOs, issue summaries, or several
rough ideas:

1. Group the notes into the smallest useful set of tickets.
2. Preview the proposed ticket titles, target repo, priority, and why each ticket
   exists.
3. If the user's prompt explicitly asks to create tickets now, write them after
   the preview in the same turn. Otherwise ask for confirmation before writing.
4. Keep imported/discovered tickets in `triage` unless the user explicitly says
   they are ready for execution.
5. Add the original note, file path, issue URL, branch, or PR URL to
   `context_refs` when available.

## Ticket Quality Bar

Every ticket should include:

- A specific `title`.
- `status: "triage"` for rough/discovered work, `backlog` only when ready to execute.
- A valid configured `repo`.
- A concise `description` with the problem and desired result.
- `acceptance_criteria` that a reviewer can verify.
- `context_refs` for relevant files, docs, issues, PRs, or commands.
- `depends_on` for real ordering constraints.

## Acceptance Criteria Style

Write criteria as observable outcomes, not implementation guesses:

- Good: "Validator reports zero errors for the new ticket."
- Good: "Projects tab shows the new project after refresh."
- Weak: "Code is clean."

## Safety

Never move a new AI-discovered ticket straight to `in_progress`. Use `triage` unless the user explicitly asks to launch work.
