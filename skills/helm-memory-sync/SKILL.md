---
name: helm-memory-sync
description: Propose durable project-memory updates after HelmMate ticket work. Use when a session discovers conventions, decisions, recurring blockers, setup knowledge, or follow-up context that should be reviewed and preserved through the board's memory sync queue.
---

# HelmMate Memory Sync

## Goal

Capture durable learning without editing curated project memory directly.

## Workflow

1. Read `helmmate.config.json` and resolve `memoryQueueDir`.
2. Review the session changes, ticket notes, verification commands, and any newly discovered conventions.
3. Write a proposal markdown file in `memoryQueueDir` named after the ticket id or a safe slug.
4. Include only durable information:
   - repo conventions
   - setup fixes
   - recurring CI or tooling issues
   - decisions made by the user
   - follow-up tickets that should be created
5. Do not include secrets, transient logs, raw credentials, or private personal notes.

## Proposal Format

```markdown
# Memory sync proposal: <ticket-or-topic>

## Proposal

<what should be added or changed>

## Evidence

<files, commands, PRs, or ticket notes that justify it>

## Suggested destination

<AGENTS.md, project manual, memory/decisions, open loops, etc.>
```

## Safety

Archive/dismiss is a human action in the board UI. Never auto-apply a proposal to curated memory unless the user explicitly asks.
