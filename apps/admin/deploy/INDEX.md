---
architectureIndex: 1
rootId: web.admin.deploy
owners:
  - "@LordFoxFairy"
---

# Admin Web deployment

## Responsibilities

Document immutable Admin image promotion, non-privileged read-only runtime configuration, probes and
forward rollback to a previous verified OCI digest.

## Public boundary

[`README.md`](README.md) is the operator runbook. The machine authority remains the repository-root
[`deployables.yaml`](../../../deployables.yaml); this directory does not define another inventory.

## Extension rules

Keep runtime credentials outside image layers and browser responses. Never use the reference Site as
an Admin or production Site artifact, accept mutable release tags, or rebuild during rollback.
