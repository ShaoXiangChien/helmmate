# Paperclip Differentiation Notes

Date: 2026-06-02

## Working Positioning

HelmMate is a lightweight, local-first command center for engineers and technical
PMs who want AI coding agents to work from real tickets, repos, worktrees, and
review gates.

Paperclip's strongest frame is "the company": agents as employees, org charts,
budgets, heartbeats, governance, goals, multi-company isolation, full audit logs,
and portable company templates.

HelmMate should not try to out-Paperclip Paperclip. The sharper wedge is:

> Paperclip helps you run an autonomous company. HelmMate helps a technical builder
> steer AI work inside existing engineering projects.

## What Paperclip Appears To Do Well

- Broad agent orchestration across business functions, not only engineering.
- Company/org-chart metaphor with roles, reporting lines, goals, governance, and
  approvals.
- Heartbeat-based agent runs for scheduled or event-triggered work.
- Budget tracking and hard stops by agent, project, goal, provider, and model.
- Ticket hierarchy, comments, atomic checkout, run history, and audit trails.
- Multi-company and multi-project isolation.
- Adapter model for Claude Code, Codex, Cursor, OpenCode, HTTP agents, and
  generic process execution.
- Runtime skill injection so agents can load workflow-specific instructions.

## HelmMate Differentiation

### 1. Engineering-native, not company-native

Paperclip maps agents to a business organization. HelmMate should map agent work to
software delivery primitives:

- repo
- branch
- worktree
- ticket
- dependency
- acceptance criteria
- test command
- PR handoff
- human review
- project memory

This is less glamorous, but much closer to what engineers and technical PMs
need every day.

### 2. Lightweight local control plane

Paperclip is a full control plane. HelmMate can be compelling by being small enough
to understand and hack:

- no required database in the first version;
- JSON tickets as the source of truth;
- local-only server by default;
- explicit ARM/autopilot controls;
- CLI commands that can fit into existing repos;
- minimal setup for a single engineer or small team.

The product promise should be "install it this afternoon and make your existing
AI coding workflow less chaotic."

### 3. Technical PM workflow, not generic task management

Technical PMs do not only want a kanban board. They want:

- a backlog that agents can actually execute;
- tickets that include context refs, dependencies, acceptance criteria, repo,
  and branch naming;
- visible blocked states and missing-context warnings;
- review-ready handoffs;
- clear "what changed, what was tested, what needs human judgment" summaries.

HelmMate can become the place where fuzzy product asks become agent-executable
engineering work.

### 4. Ticket quality as a product feature

Paperclip emphasizes orchestration, hierarchy, and execution. HelmMate can specialize
in improving the quality of work packets before agents run:

- ticket linting;
- context completeness score;
- acceptance criteria checks;
- dependency graph validation;
- stale-ticket detection;
- "make this agent-ready" drafting;
- "split this into smaller tickets" flow;
- PM-to-engineering translation.

This is a strong wedge because poor tickets create poor agent output.

### 5. Local repo/worktree ergonomics

Make HelmMate unusually good at the boring but painful parts of AI coding:

- prepare a clean worktree;
- launch the right engine in the right directory;
- keep logs and usage near the ticket;
- detect dirty branches before launch;
- show PR state and review blockers;
- clean stale worktrees;
- hand off to humans without auto-merging.

This is less broad than Paperclip, but it is immediately valuable to technical
users.

### 6. Human-led autonomy

Paperclip leans toward autonomous company operation. HelmMate can be calmer:

- human sets project direction;
- agents execute bounded tickets;
- risky actions are gated;
- finished work stops at human review;
- memory updates are proposed, not silently committed;
- the UI makes unsafe launch states visible.

This is an advantage for engineers who want leverage without pretending the AI
is a fully trusted employee.

## Target Audience

Primary:

- solo technical founders;
- senior engineers using multiple coding agents;
- technical PMs who write implementation-ready tickets;
- small product teams that want local agent execution without adopting a heavy
  orchestration suite.

Secondary:

- open-source maintainers who want contributors or agents to work from stricter
  tickets;
- consultants managing multiple client codebases;
- teams experimenting with Codex/Claude/Cursor/OpenCode in parallel.

## Product Pillars

1. Agent-ready tickets
2. Local project cockpit
3. Review-gated execution
4. Multi-project visibility
5. Lightweight skills and diagnostics

## Feature Bets

### Near-term

- Rename product surfaces to HelmMate while keeping `helmmate` CLI/package as the
  migration name.
- Improve onboarding around "make your first agent-ready ticket."
- Add a Doctor page for setup, missing CLIs, bad config, stale worktrees, and
  launch blockers.
- Add ticket editing and ticket linting in the side panel.
- Add project switcher with restart/live-switch semantics made explicit.
- Add skill install/copy flow so agents can use HelmMate skills with less manual
  setup.

### Medium-term

- Ticket quality score with concrete missing-context suggestions.
- Project memory queue review UI.
- PR handoff dashboard with test status, branch, changed files, and review notes.
- Worktree cleanup and conflict repair flows.
- Engine adapter interface for Codex, Claude, Cursor, OpenCode, Gemini, Aider,
  and custom scripts.
- Cost/usage tracking that starts simple: per launch, per ticket, per engine,
  without trying to become a full budget system first.

### Later

- Team mode and shared auth, only after local-first flow is excellent.
- Optional database storage, only if JSON tickets become limiting.
- Goal/project hierarchy, but tuned to software delivery rather than company
  simulation.
- External integrations with GitHub Issues, Linear, Notion, or Jira.

## Messaging Ideas

- "A local cockpit for AI coding work."
- "Turn product asks into agent-ready engineering tickets."
- "Steer Codex, Claude, Cursor, and local agents from one lightweight board."
- "Human-led, review-gated AI software delivery."
- "Less autonomous company, more practical engineering control plane."

## Anti-Positioning

HelmMate should avoid claiming:

- "run your whole company";
- "zero-human business";
- "fully autonomous engineering team";
- "replace your PM";
- "agents are employees."

Those frames create higher expectations and put HelmMate directly into Paperclip's
strongest territory.

## Research Sources

- Paperclip homepage: https://paperclip.ing/
- Paperclip GitHub README: https://github.com/paperclipinc/paperclip
- Paperclip agent management docs: https://paperclip.inc/docs/guides/board-operator/managing-agents
- Paperclip task management docs: https://paperclip.inc/docs/guides/board-operator/managing-tasks
- Paperclip heartbeat protocol: https://paperclip.inc/docs/guides/agent-developer/heartbeat-protocol
- Paperclip goals and projects API: https://paperclip.inc/docs/api/goals-and-projects
- Paperclip costs API: https://paperclip.inc/docs/api/costs
- Paperclip CLI overview: https://paperclip.inc/docs/cli/overview
- Kubernetes Helm homepage, naming collision context: https://helm.sh/
