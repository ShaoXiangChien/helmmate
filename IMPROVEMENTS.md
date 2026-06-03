# Roadmap

HelmMate is a local dashboard for agent-driven ticket queues. This roadmap
tracks improvements that make the tool safer, more configurable, and easier for
other projects to adopt.

## Shipped In v0.1

- Config file for workspace path, tickets path, repo keys, statuses, roles,
  memory queue, prompt files, engines, host, and port.
- Local-only host binding by default.
- Generic package metadata and open-source hygiene docs.
- Ticket schemas.
- CLI entry points for `init`, `new-ticket`, `validate`, and `start`.
- Config-backed repo validation, worktree paths, role mapping, memory queue path,
  server host, and board columns.

## Next Safety Work

- Add a Doctor page for missing CLIs, git auth, stale worktrees, bad config, and
  unsafe ARM/autopilot state.
- Add dry-run mode that logs the exact command that would launch without spawning
  an agent.
- Make dangerous engine flags opt-in and visible in the UI.
- Add a fake engine for tests so CI never launches real agent CLIs.

## Ticket System

- Add richer schema validation without adding a build step.
- Add Markdown ticket import/export while keeping JSON as the canonical format.
- Add ticket editing for description, acceptance criteria, dependencies, and
  context refs directly in the side panel.
- Add empty states and onboarding for projects with no tickets yet.

## Launch Engines

- Formalize an engine interface for availability checks, work args, fix args,
  usage reads, and run log parsing.
- Keep built-in support for Claude and Codex optional.
- Allow custom engine commands for tools such as Aider, Gemini CLI, Goose, or
  project-specific scripts.

## Review Handoff

- Add a PR provider abstraction for non-GitHub projects.
- Support projects that do not use PRs with an alternate "ready for review"
  handoff.
- Add review checklists for human reviewers without ever auto-merging.

## Tests And Release

- Unit-test config loading, ticket writes, validation, dependency gating, branch
  naming, and engine arg construction.
- Integration-test ticket movement and index rewrites in temp directories.
- Add GitHub Actions for validation and tests.
- Publish as an npm package with a `dev-board` binary.
