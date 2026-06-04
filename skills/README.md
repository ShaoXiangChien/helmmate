# HelmMate Skill Pack

These are product-neutral skill templates intended to ship with HelmMate or be
copied into a local agent skills directory.

- `helm-setup-project`: configure projects and initialize local scaffold.
- `helm-init`: initialize a fresh project workspace, then register it.
- `helm-create-ticket`: turn rough ideas into valid JSON tickets.
- `helm-work-ticket`: implement one ticket through PR handoff.
- `helm-fix-pr`: fix CI failures or conflicts on an existing PR.
- `helm-memory-sync`: propose durable memory updates through the queue.
- `helm-doctor`: diagnose setup, tickets, launch readiness, and board state.

The pack is deliberately split by workflow stage so agents load only the context
needed for the current job.
