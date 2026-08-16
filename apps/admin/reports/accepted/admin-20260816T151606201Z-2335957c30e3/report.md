---
report_type: kokoro-admin-web-repository-acceptance
run_id: admin-20260816T151606201Z-2335957c30e3
admin_web_repository_decision: PASS
product_pair_decision: NOT_READY
started_at_utc: 2026-08-16T15:16:06.189Z
finished_at_utc: 2026-08-16T15:16:31.108Z
started_at_local: 2026-08-16T11:16:06.189-04:00
finished_at_local: 2026-08-16T11:16:31.108-04:00
timezone_offset: -04:00
---

# Kokoro Admin Web Repository Acceptance Report

## Overall Mark

| Scope | Decision | Meaning |
|---|---|---|
| Admin Web repository | **PASS** | All repository-owned classified gates and runtime evidence. |
| Product pair | **NOT_READY** | Two fresh visible Chromium rounds remain pair-owned. |

## Time And Candidate

| Field | Value |
|---|---|
| Started local / UTC | `2026-08-16T11:16:06.189-04:00` / `2026-08-16T15:16:06.189Z` |
| Finished local / UTC | `2026-08-16T11:16:31.108-04:00` / `2026-08-16T15:16:31.108Z` |
| Timezone offset | `-04:00` |
| Duration | `24.919s` |
| Branch | `codex/admin-web-iam-control-plane` |
| Commit / tree | `2335957c30e3a74c946218e435e1f7d28623c506` / `a760ea5ae25a6cec3f9218dfaeb51a276904ea14` |
| Dirty before / after | `false` / `false` |
| Web catalog SHA-256 | `acc0da65b5df7b6d8d91c132eae9b68c01516801fe3d2f74e46ef2bbb82f44aa` |

## Frozen IAM Provider

| Commit / tree | Proto | Migration | Catalog | Accepted run |
|---|---|---|---|---|
| `16afccdbec9c22176f9fd493feeb0ed0d7fe3445` / `a72b870c8e890eb63176ddb80cc34df3658a474f` | `4daad8affaa7eb36e8f587dca3a016dd080b3ca4f3e36f08a19963133a27e38a` | `846491c5a72331a8d7aa1a2b51a153165dc636957ac1edf867e3836405f358c2` | `e388f4a865fa98744989f3e7a6d41d2bf8e6367ae51b8eeee804c763b4bc8552` | `iam-20260816T111434155Z-16afccdbec9c` |

## Runtime Inventory

| Field | Value |
|---|---|
| host | `nakodeMacBook-Pro.local` |
| os | `darwin 24.6.0` |
| node | `v22.22.2` |
| pnpm | `11.2.2` |
| timezoneOffset | `-04:00` |
| chromium | `Pair acceptance-owned; not executed in repository acceptance` |

## Gate Ledger

| Gate | Result | Start local / UTC | Finish local / UTC | Duration | Exit | Evidence |
|---|---|---|---|---:|---:|---|
| install | PASS | 2026-08-16T11:16:06.404-04:00 / 2026-08-16T15:16:06.404Z | 2026-08-16T11:16:06.588-04:00 / 2026-08-16T15:16:06.588Z | 0.184s | 0 | `commands/install.stdout.log`, `commands/install.stderr.log` |
| proto_check | PASS | 2026-08-16T11:16:06.588-04:00 / 2026-08-16T15:16:06.588Z | 2026-08-16T11:16:07.473-04:00 / 2026-08-16T15:16:07.473Z | 0.885s | 0 | `commands/proto_check.stdout.log`, `commands/proto_check.stderr.log` |
| test_unit | PASS | 2026-08-16T11:16:07.473-04:00 / 2026-08-16T15:16:07.473Z | 2026-08-16T11:16:08.193-04:00 / 2026-08-16T15:16:08.193Z | 0.720s | 0 | `commands/test_unit.stdout.log`, `commands/test_unit.stderr.log` |
| test_component | PASS | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 7.414s | 0 | `commands/test_component.stdout.log`, `commands/test_component.stderr.log` |
| test_contract | PASS | 2026-08-16T11:16:15.611-04:00 / 2026-08-16T15:16:15.611Z | 2026-08-16T11:16:17.019-04:00 / 2026-08-16T15:16:17.019Z | 1.408s | 0 | `commands/test_contract.stdout.log`, `commands/test_contract.stderr.log` |
| test_integration | PASS | 2026-08-16T11:16:17.020-04:00 / 2026-08-16T15:16:17.020Z | 2026-08-16T11:16:17.956-04:00 / 2026-08-16T15:16:17.956Z | 0.936s | 0 | `commands/test_integration.stdout.log`, `commands/test_integration.stderr.log` |
| test_security | PASS | 2026-08-16T11:16:17.959-04:00 / 2026-08-16T15:16:17.959Z | 2026-08-16T11:16:18.851-04:00 / 2026-08-16T15:16:18.851Z | 0.892s | 0 | `commands/test_security.stdout.log`, `commands/test_security.stderr.log` |
| typecheck | PASS | 2026-08-16T11:16:18.853-04:00 / 2026-08-16T15:16:18.853Z | 2026-08-16T11:16:20.437-04:00 / 2026-08-16T15:16:20.437Z | 1.584s | 0 | `commands/typecheck.stdout.log`, `commands/typecheck.stderr.log` |
| lint | PASS | 2026-08-16T11:16:20.437-04:00 / 2026-08-16T15:16:20.437Z | 2026-08-16T11:16:22.531-04:00 / 2026-08-16T15:16:22.531Z | 2.094s | 0 | `commands/lint.stdout.log`, `commands/lint.stderr.log` |
| build | PASS | 2026-08-16T11:16:22.531-04:00 / 2026-08-16T15:16:22.531Z | 2026-08-16T11:16:29.946-04:00 / 2026-08-16T15:16:29.946Z | 7.415s | 0 | `commands/build.stdout.log`, `commands/build.stderr.log` |
| runtime_smoke | PASS | 2026-08-16T11:16:29.946-04:00 / 2026-08-16T15:16:29.946Z | 2026-08-16T11:16:31.092-04:00 / 2026-08-16T15:16:31.092Z | 1.146s | 0 | `commands/runtime_smoke.stdout.log`, `commands/runtime_smoke.stderr.log` |

## Category Summary

| Category | Result | Total | Passed | Failed | Pending | Start local / UTC | Finish local / UTC |
|---|---|---:|---:|---:|---:|---|---|
| unit | PASS | 8 | 8 | 0 | 0 | 2026-08-16T11:16:07.473-04:00 / 2026-08-16T15:16:07.473Z | 2026-08-16T11:16:08.193-04:00 / 2026-08-16T15:16:08.193Z |
| component | PASS | 11 | 11 | 0 | 0 | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z |
| contract | PASS | 8 | 8 | 0 | 0 | 2026-08-16T11:16:15.611-04:00 / 2026-08-16T15:16:15.611Z | 2026-08-16T11:16:17.019-04:00 / 2026-08-16T15:16:17.019Z |
| integration | PASS | 8 | 8 | 0 | 0 | 2026-08-16T11:16:17.020-04:00 / 2026-08-16T15:16:17.020Z | 2026-08-16T11:16:17.956-04:00 / 2026-08-16T15:16:17.956Z |
| security | PASS | 9 | 9 | 0 | 0 | 2026-08-16T11:16:17.959-04:00 / 2026-08-16T15:16:17.959Z | 2026-08-16T11:16:18.851-04:00 / 2026-08-16T15:16:18.851Z |
| pair_e2e | NOT_STARTED | 10 | 0 | 0 | 10 | - | - |

## Case Ledger

| Case | Category | Result | Test file | Start local / UTC | Finish local / UTC | Attempts | Evidence |
|---|---|---|---|---|---|---:|---|
| WEB-UNIT-CONFIG-001 | unit | PASS | test/unit/config.test.ts | 2026-08-16T11:16:07.473-04:00 / 2026-08-16T15:16:07.473Z | 2026-08-16T11:16:08.193-04:00 / 2026-08-16T15:16:08.193Z | 1 | `junit/unit.xml`, `json/unit.json`, `coverage/unit/coverage-summary.json`, `commands/test_unit.stdout.log` |
| WEB-UNIT-SECRET-001 | unit | PASS | test/unit/secret-file.test.ts | 2026-08-16T11:16:07.473-04:00 / 2026-08-16T15:16:07.473Z | 2026-08-16T11:16:08.193-04:00 / 2026-08-16T15:16:08.193Z | 1 | `junit/unit.xml`, `json/unit.json`, `coverage/unit/coverage-summary.json`, `commands/test_unit.stdout.log` |
| WEB-UNIT-COOKIE-001 | unit | PASS | test/unit/auth-cookie.test.ts | 2026-08-16T11:16:07.473-04:00 / 2026-08-16T15:16:07.473Z | 2026-08-16T11:16:08.193-04:00 / 2026-08-16T15:16:08.193Z | 1 | `junit/unit.xml`, `json/unit.json`, `coverage/unit/coverage-summary.json`, `commands/test_unit.stdout.log` |
| WEB-UNIT-ADAPTER-001 | unit | PASS | test/unit/auth-adapter.test.ts | 2026-08-16T11:16:07.473-04:00 / 2026-08-16T15:16:07.473Z | 2026-08-16T11:16:08.193-04:00 / 2026-08-16T15:16:08.193Z | 1 | `junit/unit.xml`, `json/unit.json`, `coverage/unit/coverage-summary.json`, `commands/test_unit.stdout.log` |
| WEB-UNIT-ERROR-001 | unit | PASS | test/unit/iam-error.test.ts | 2026-08-16T11:16:07.473-04:00 / 2026-08-16T15:16:07.473Z | 2026-08-16T11:16:08.193-04:00 / 2026-08-16T15:16:08.193Z | 1 | `junit/unit.xml`, `json/unit.json`, `coverage/unit/coverage-summary.json`, `commands/test_unit.stdout.log` |
| WEB-UNIT-RECORD-001 | unit | PASS | test/unit/iam-records.test.ts | 2026-08-16T11:16:07.473-04:00 / 2026-08-16T15:16:07.473Z | 2026-08-16T11:16:08.193-04:00 / 2026-08-16T15:16:08.193Z | 1 | `junit/unit.xml`, `json/unit.json`, `coverage/unit/coverage-summary.json`, `commands/test_unit.stdout.log` |
| WEB-UNIT-COMMAND-001 | unit | PASS | test/unit/command-identity.test.ts | 2026-08-16T11:16:07.473-04:00 / 2026-08-16T15:16:07.473Z | 2026-08-16T11:16:08.193-04:00 / 2026-08-16T15:16:08.193Z | 1 | `junit/unit.xml`, `json/unit.json`, `coverage/unit/coverage-summary.json`, `commands/test_unit.stdout.log` |
| WEB-UNIT-PAGE-001 | unit | PASS | test/unit/pagination.test.ts | 2026-08-16T11:16:07.473-04:00 / 2026-08-16T15:16:07.473Z | 2026-08-16T11:16:08.193-04:00 / 2026-08-16T15:16:08.193Z | 1 | `junit/unit.xml`, `json/unit.json`, `coverage/unit/coverage-summary.json`, `commands/test_unit.stdout.log` |
| WEB-COMP-LOGIN-001 | component | PASS | test/component/login.test.tsx | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 1 | `junit/component.xml`, `json/component.json`, `coverage/component/coverage-summary.json`, `commands/test_component.stdout.log` |
| WEB-COMP-SHELL-001 | component | PASS | test/component/admin-shell.test.tsx | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 1 | `junit/component.xml`, `json/component.json`, `coverage/component/coverage-summary.json`, `commands/test_component.stdout.log` |
| WEB-COMP-OVERVIEW-001 | component | PASS | test/component/overview.test.tsx | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 1 | `junit/component.xml`, `json/component.json`, `coverage/component/coverage-summary.json`, `commands/test_component.stdout.log` |
| WEB-COMP-STATE-001 | component | PASS | test/component/page-state.test.tsx | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 1 | `junit/component.xml`, `json/component.json`, `coverage/component/coverage-summary.json`, `commands/test_component.stdout.log` |
| WEB-COMP-USER-001 | component | PASS | test/component/users.test.tsx | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 1 | `junit/component.xml`, `json/component.json`, `coverage/component/coverage-summary.json`, `commands/test_component.stdout.log` |
| WEB-COMP-SESSION-001 | component | PASS | test/component/sessions.test.tsx | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 1 | `junit/component.xml`, `json/component.json`, `coverage/component/coverage-summary.json`, `commands/test_component.stdout.log` |
| WEB-COMP-ORG-001 | component | PASS | test/component/organizations.test.tsx | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 1 | `junit/component.xml`, `json/component.json`, `coverage/component/coverage-summary.json`, `commands/test_component.stdout.log` |
| WEB-COMP-MEMBER-001 | component | PASS | test/component/members.test.tsx | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 1 | `junit/component.xml`, `json/component.json`, `coverage/component/coverage-summary.json`, `commands/test_component.stdout.log` |
| WEB-COMP-ACCESS-001 | component | PASS | test/component/access.test.tsx | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 1 | `junit/component.xml`, `json/component.json`, `coverage/component/coverage-summary.json`, `commands/test_component.stdout.log` |
| WEB-COMP-AUDIT-001 | component | PASS | test/component/audit.test.tsx | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 1 | `junit/component.xml`, `json/component.json`, `coverage/component/coverage-summary.json`, `commands/test_component.stdout.log` |
| WEB-COMP-A11Y-001 | component | PASS | test/component/command-dialog.test.tsx | 2026-08-16T11:16:08.195-04:00 / 2026-08-16T15:16:08.195Z | 2026-08-16T11:16:15.609-04:00 / 2026-08-16T15:16:15.609Z | 1 | `junit/component.xml`, `json/component.json`, `coverage/component/coverage-summary.json`, `commands/test_component.stdout.log` |
| WEB-CONTRACT-CATALOG-001 | contract | PASS | test/contract/catalog.test.ts | 2026-08-16T11:16:15.611-04:00 / 2026-08-16T15:16:15.611Z | 2026-08-16T11:16:17.019-04:00 / 2026-08-16T15:16:17.019Z | 1 | `junit/contract.xml`, `json/contract.json`, `coverage/contract/coverage-summary.json`, `commands/test_contract.stdout.log` |
| WEB-CONTRACT-TOOLS-001 | contract | PASS | test/contract/toolchain-boundary.test.ts | 2026-08-16T11:16:15.611-04:00 / 2026-08-16T15:16:15.611Z | 2026-08-16T11:16:17.019-04:00 / 2026-08-16T15:16:17.019Z | 1 | `junit/contract.xml`, `json/contract.json`, `coverage/contract/coverage-summary.json`, `commands/test_contract.stdout.log` |
| WEB-CONTRACT-PROTO-001 | contract | PASS | test/contract/provider-snapshot.test.ts | 2026-08-16T11:16:15.611-04:00 / 2026-08-16T15:16:15.611Z | 2026-08-16T11:16:17.019-04:00 / 2026-08-16T15:16:17.019Z | 1 | `junit/contract.xml`, `json/contract.json`, `coverage/contract/coverage-summary.json`, `commands/test_contract.stdout.log` |
| WEB-CONTRACT-RPC-001 | contract | PASS | test/contract/generated-services.test.ts | 2026-08-16T11:16:15.611-04:00 / 2026-08-16T15:16:15.611Z | 2026-08-16T11:16:17.019-04:00 / 2026-08-16T15:16:17.019Z | 1 | `junit/contract.xml`, `json/contract.json`, `coverage/contract/coverage-summary.json`, `commands/test_contract.stdout.log` |
| WEB-CONTRACT-BOUNDARY-001 | contract | PASS | test/contract/server-boundary.test.ts | 2026-08-16T11:16:15.611-04:00 / 2026-08-16T15:16:15.611Z | 2026-08-16T11:16:17.019-04:00 / 2026-08-16T15:16:17.019Z | 1 | `junit/contract.xml`, `json/contract.json`, `coverage/contract/coverage-summary.json`, `commands/test_contract.stdout.log` |
| WEB-CONTRACT-I18N-001 | contract | PASS | test/contract/i18n-completeness.test.ts | 2026-08-16T11:16:15.611-04:00 / 2026-08-16T15:16:15.611Z | 2026-08-16T11:16:17.019-04:00 / 2026-08-16T15:16:17.019Z | 1 | `junit/contract.xml`, `json/contract.json`, `coverage/contract/coverage-summary.json`, `commands/test_contract.stdout.log` |
| WEB-CONTRACT-BUILD-001 | contract | PASS | test/contract/build-boundary.test.ts | 2026-08-16T11:16:15.611-04:00 / 2026-08-16T15:16:15.611Z | 2026-08-16T11:16:17.019-04:00 / 2026-08-16T15:16:17.019Z | 1 | `junit/contract.xml`, `json/contract.json`, `coverage/contract/coverage-summary.json`, `commands/test_contract.stdout.log`, `build/boundary.json` |
| WEB-CONTRACT-RUNTIME-001 | contract | PASS | test/contract/runtime-listener.test.ts | 2026-08-16T11:16:15.611-04:00 / 2026-08-16T15:16:15.611Z | 2026-08-16T11:16:17.019-04:00 / 2026-08-16T15:16:17.019Z | 1 | `junit/contract.xml`, `json/contract.json`, `coverage/contract/coverage-summary.json`, `commands/test_contract.stdout.log`, `http/smoke.json`, `rpc/smoke.json`, `logs/admin.stdout.log`, `logs/admin.stderr.log` |
| WEB-INT-AUTH-001 | integration | PASS | test/integration/auth-routes.test.ts | 2026-08-16T11:16:17.020-04:00 / 2026-08-16T15:16:17.020Z | 2026-08-16T11:16:17.956-04:00 / 2026-08-16T15:16:17.956Z | 1 | `junit/integration.xml`, `json/integration.json`, `coverage/integration/coverage-summary.json`, `commands/test_integration.stdout.log`, `http/smoke.json`, `rpc/smoke.json` |
| WEB-INT-SESSION-001 | integration | PASS | test/integration/database-session.test.ts | 2026-08-16T11:16:17.020-04:00 / 2026-08-16T15:16:17.020Z | 2026-08-16T11:16:17.956-04:00 / 2026-08-16T15:16:17.956Z | 1 | `junit/integration.xml`, `json/integration.json`, `coverage/integration/coverage-summary.json`, `commands/test_integration.stdout.log`, `rpc/smoke.json` |
| WEB-INT-USER-001 | integration | PASS | test/integration/user-actions.test.ts | 2026-08-16T11:16:17.020-04:00 / 2026-08-16T15:16:17.020Z | 2026-08-16T11:16:17.956-04:00 / 2026-08-16T15:16:17.956Z | 1 | `junit/integration.xml`, `json/integration.json`, `coverage/integration/coverage-summary.json`, `commands/test_integration.stdout.log`, `rpc/smoke.json` |
| WEB-INT-SESSION-002 | integration | PASS | test/integration/session-actions.test.ts | 2026-08-16T11:16:17.020-04:00 / 2026-08-16T15:16:17.020Z | 2026-08-16T11:16:17.956-04:00 / 2026-08-16T15:16:17.956Z | 1 | `junit/integration.xml`, `json/integration.json`, `coverage/integration/coverage-summary.json`, `commands/test_integration.stdout.log`, `rpc/smoke.json` |
| WEB-INT-ORG-001 | integration | PASS | test/integration/organization-actions.test.ts | 2026-08-16T11:16:17.020-04:00 / 2026-08-16T15:16:17.020Z | 2026-08-16T11:16:17.956-04:00 / 2026-08-16T15:16:17.956Z | 1 | `junit/integration.xml`, `json/integration.json`, `coverage/integration/coverage-summary.json`, `commands/test_integration.stdout.log`, `rpc/smoke.json` |
| WEB-INT-MEMBER-001 | integration | PASS | test/integration/member-actions.test.ts | 2026-08-16T11:16:17.020-04:00 / 2026-08-16T15:16:17.020Z | 2026-08-16T11:16:17.956-04:00 / 2026-08-16T15:16:17.956Z | 1 | `junit/integration.xml`, `json/integration.json`, `coverage/integration/coverage-summary.json`, `commands/test_integration.stdout.log`, `rpc/smoke.json` |
| WEB-INT-AUDIT-001 | integration | PASS | test/integration/audit-query.test.ts | 2026-08-16T11:16:17.020-04:00 / 2026-08-16T15:16:17.020Z | 2026-08-16T11:16:17.956-04:00 / 2026-08-16T15:16:17.956Z | 1 | `junit/integration.xml`, `json/integration.json`, `coverage/integration/coverage-summary.json`, `commands/test_integration.stdout.log`, `rpc/smoke.json` |
| WEB-INT-SMOKE-001 | integration | PASS | test/integration/runtime-smoke.test.ts | 2026-08-16T11:16:17.020-04:00 / 2026-08-16T15:16:17.020Z | 2026-08-16T11:16:17.956-04:00 / 2026-08-16T15:16:17.956Z | 1 | `junit/integration.xml`, `json/integration.json`, `coverage/integration/coverage-summary.json`, `commands/test_integration.stdout.log`, `http/smoke.json`, `logs/admin.stdout.log`, `logs/admin.stderr.log` |
| WEB-SEC-ENUM-001 | security | PASS | test/security/enumeration.test.ts | 2026-08-16T11:16:17.959-04:00 / 2026-08-16T15:16:17.959Z | 2026-08-16T11:16:18.851-04:00 / 2026-08-16T15:16:18.851Z | 1 | `junit/security.xml`, `json/security.json`, `coverage/security/coverage-summary.json`, `commands/test_security.stdout.log`, `http/smoke.json`, `rpc/smoke.json`, `logs/admin.stdout.log`, `logs/admin.stderr.log` |
| WEB-SEC-REDIRECT-001 | security | PASS | test/security/redirect-policy.test.ts | 2026-08-16T11:16:17.959-04:00 / 2026-08-16T15:16:17.959Z | 2026-08-16T11:16:18.851-04:00 / 2026-08-16T15:16:18.851Z | 1 | `junit/security.xml`, `json/security.json`, `coverage/security/coverage-summary.json`, `commands/test_security.stdout.log`, `http/smoke.json` |
| WEB-SEC-SECRET-001 | security | PASS | test/security/secret-leakage.test.ts | 2026-08-16T11:16:17.959-04:00 / 2026-08-16T15:16:17.959Z | 2026-08-16T11:16:18.851-04:00 / 2026-08-16T15:16:18.851Z | 1 | `junit/security.xml`, `json/security.json`, `coverage/security/coverage-summary.json`, `commands/test_security.stdout.log` |
| WEB-SEC-ROUTE-001 | security | PASS | test/security/route-authorization.test.ts | 2026-08-16T11:16:17.959-04:00 / 2026-08-16T15:16:17.959Z | 2026-08-16T11:16:18.851-04:00 / 2026-08-16T15:16:18.851Z | 1 | `junit/security.xml`, `json/security.json`, `coverage/security/coverage-summary.json`, `commands/test_security.stdout.log`, `http/smoke.json`, `rpc/smoke.json` |
| WEB-SEC-TENANT-001 | security | PASS | test/security/tenant-isolation.test.ts | 2026-08-16T11:16:17.959-04:00 / 2026-08-16T15:16:17.959Z | 2026-08-16T11:16:18.851-04:00 / 2026-08-16T15:16:18.851Z | 1 | `junit/security.xml`, `json/security.json`, `coverage/security/coverage-summary.json`, `commands/test_security.stdout.log`, `rpc/smoke.json` |
| WEB-SEC-OWNER-001 | security | PASS | test/security/last-owner.test.ts | 2026-08-16T11:16:17.959-04:00 / 2026-08-16T15:16:17.959Z | 2026-08-16T11:16:18.851-04:00 / 2026-08-16T15:16:18.851Z | 1 | `junit/security.xml`, `json/security.json`, `coverage/security/coverage-summary.json`, `commands/test_security.stdout.log`, `rpc/smoke.json` |
| WEB-SEC-HEADER-001 | security | PASS | test/security/headers.test.ts | 2026-08-16T11:16:17.959-04:00 / 2026-08-16T15:16:17.959Z | 2026-08-16T11:16:18.851-04:00 / 2026-08-16T15:16:18.851Z | 1 | `junit/security.xml`, `json/security.json`, `coverage/security/coverage-summary.json`, `commands/test_security.stdout.log`, `http/smoke.json` |
| WEB-SEC-INPUT-001 | security | PASS | test/security/hostile-input.test.ts | 2026-08-16T11:16:17.959-04:00 / 2026-08-16T15:16:17.959Z | 2026-08-16T11:16:18.851-04:00 / 2026-08-16T15:16:18.851Z | 1 | `junit/security.xml`, `json/security.json`, `coverage/security/coverage-summary.json`, `commands/test_security.stdout.log`, `http/smoke.json`, `rpc/smoke.json` |
| WEB-SEC-METADATA-001 | security | PASS | test/security/audit-metadata.test.ts | 2026-08-16T11:16:17.959-04:00 / 2026-08-16T15:16:17.959Z | 2026-08-16T11:16:18.851-04:00 / 2026-08-16T15:16:18.851Z | 1 | `junit/security.xml`, `json/security.json`, `coverage/security/coverage-summary.json`, `commands/test_security.stdout.log` |
| IAM-SEC-ENUM-001 | pair_e2e | NOT_STARTED | Pair-owned | - | - | 0 | Pending pair evidence |
| IAM-SEC-REDIRECT-001 | pair_e2e | NOT_STARTED | Pair-owned | - | - | 0 | Pending pair evidence |
| IAM-E2E-AUTH-001 | pair_e2e | NOT_STARTED | Pair-owned | - | - | 0 | Pending pair evidence |
| IAM-E2E-SESSION-001 | pair_e2e | NOT_STARTED | Pair-owned | - | - | 0 | Pending pair evidence |
| IAM-E2E-ORG-001 | pair_e2e | NOT_STARTED | Pair-owned | - | - | 0 | Pending pair evidence |
| IAM-E2E-MEMBER-001 | pair_e2e | NOT_STARTED | Pair-owned | - | - | 0 | Pending pair evidence |
| IAM-E2E-RBAC-001 | pair_e2e | NOT_STARTED | Pair-owned | - | - | 0 | Pending pair evidence |
| IAM-E2E-DELETE-001 | pair_e2e | NOT_STARTED | Pair-owned | - | - | 0 | Pending pair evidence |
| IAM-E2E-IDEM-001 | pair_e2e | NOT_STARTED | Pair-owned | - | - | 0 | Pending pair evidence |
| IAM-E2E-FRESH-001 | pair_e2e | NOT_STARTED | Pair-owned | - | - | 0 | Pending pair evidence |

## Runtime And Browser Evidence

Repository runtime evidence: `http/smoke.json`, `rpc/smoke.json`, `build/boundary.json`, `process/smoke.json`, and Admin logs.
Screenshots, trace, video, HAR, per-step timestamps, browser RPC/SQL/log correlation, and two fresh visible Chromium rounds remain `NOT_STARTED` until pair acceptance.

## Integrity

- Secret scan: `PASS` across `43` retained text artifacts; matches: `0`.
- Retry count: `0`.
- Skip/todo/unclassified count: `0 / 0 / 0`.
- Ordered SHA-256 values: `sha256sums.txt`.

## Failure Ledger

No Admin Web repository-owned gate or P0 case failed.

## Decision

- `ADMIN_WEB_REPOSITORY_DECISION=PASS`
- `PRODUCT_PAIR_DECISION=NOT_READY`
- Decision local / UTC: `2026-08-16T11:16:31.108-04:00` / `2026-08-16T15:16:31.108Z`
