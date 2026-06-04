# Security

HelmMate is designed as a local-only tool. It can launch local agent CLIs that
edit files, run commands, create branches, push commits, and open pull requests.

## Safe Defaults

- The board binds to `127.0.0.1` by default.
- The board starts disarmed.
- Autopilot starts off.
- The WIP limit defaults to 2.
- Tickets must pass dependency and preflight checks before launch.
- Finished work is expected to stop at `human_review`; the board does not merge.

## Operational Guidance

- Do not expose the server to the public internet.
- Review `helmmate.config.json` before arming the board.
- Treat agent engines as privileged local processes.
- Keep OAuth credentials, usage caches, logs, run ledgers, local state, tickets,
  and worktrees out of git unless you intentionally want to publish them.

## Reporting

Please open a private security advisory or contact the maintainers before
publishing details for vulnerabilities that could expose local files, secrets, or
agent-launch controls.
