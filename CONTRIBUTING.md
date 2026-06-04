# Contributing

Thanks for helping improve HelmMate.

## Safety Model

Changes should preserve the core review-gated workflow:

- Disarmed by default.
- Autopilot off by default.
- No auto-merge.
- Human review before done.
- WIP limit enforced.
- Dependency checks before launch.
- Agent engine usage is explicit and visible.

If a change makes autonomous launches easier, it should also make launch blockers
and risks clearer.

## Development

```bash
npm install
npm run validate:tickets
npm start
```

Use `helmmate.config.json` for local repo paths and ticket settings. Avoid
committing private tickets, logs, state files, run ledgers, usage caches, or
worktrees.

## Pull Requests

- Keep changes scoped.
- Include validation or tests for behavior changes.
- Prefer configurable defaults over project-specific assumptions.
- Keep public copy product-neutral.
