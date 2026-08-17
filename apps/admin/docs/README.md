# Admin Web Documents

- Product: `product/PRD-003-iam-site-management-experience.md`
- UI architecture: `architecture/iam-site-management-ui-technical-design.md`
- Implementation: `plans/2026-08-17-iam-site-management-ui-implementation.md`

Read target-state documents in this order before changing the management console:

1. `decisions/ADR-002-multi-method-administrator-authentication.md`
2. `lessons/authentication-model.md`
3. `product/PRD-002-admin-platform-shell.md`
4. `architecture/admin-platform-shell-technical-design.md`
5. `plans/2026-08-16-admin-platform-shell-implementation.md`
6. `product/PRD-001-iam-control-plane.md`
7. `architecture/iam-control-plane-technical-design.md`
8. `decisions/ADR-001-iam-rpc-control-plane.md`
9. `plans/2026-08-15-iam-control-plane-implementation.md`

Test execution authority and report structure:

- `../test/README.md`
- `../test/catalog/p0.yaml`
- `../reports/templates/acceptance-report.md`

The current implementation may lag these documents until the implementation plan is complete. Do
not add compatibility paths to reduce that gap; execute the hard-cut plan and update this index when
the accepted target changes.
