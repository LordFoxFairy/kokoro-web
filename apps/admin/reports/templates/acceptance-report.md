# Admin Web Acceptance Report

## Overall Mark

| Field | Value |
| --- | --- |
| Run ID | `ADMIN_RUN_ID` |
| Decision | `PASS_OR_FAIL` |
| Scope | `REPOSITORY_OR_PAIR` |
| Started (local) | `LOCAL_STARTED_AT` |
| Finished (local) | `LOCAL_FINISHED_AT` |
| Started (UTC) | `UTC_STARTED_AT` |
| Finished (UTC) | `UTC_FINISHED_AT` |
| Timezone offset | `TIMEZONE_OFFSET` |
| Duration | `DURATION_MS` |
| Admin commit / tree | `ADMIN_COMMIT` / `ADMIN_TREE` |
| IAM commit / tree | `IAM_COMMIT` / `IAM_TREE` |
| Working tree | `CLEAN_OR_DIRTY` |
| Retry / skip / todo | `0 / 0 / 0` |

The overall mark is `PASS` only when every required category and case passes, every expected
artifact exists, the secret scan passes, and every ordered SHA-256 value verifies.

## Runtime Inventory

| Component | Version or immutable identity |
| --- | --- |
| Node.js | `NODE_VERSION` |
| pnpm | `PNPM_VERSION` |
| Chromium | `CHROMIUM_VERSION` |
| PostgreSQL | `POSTGRESQL_VERSION` |
| Local mailbox fixture | `IN_PROCESS_SMTP_API` |
| IAM Proto SHA-256 | `IAM_PROTO_SHA256` |
| IAM migration SHA-256 | `IAM_MIGRATION_SHA256` |
| IAM P0 catalog SHA-256 | `IAM_CATALOG_SHA256` |

## Category Summary

| Category | Total | Passed | Failed | Skipped | Retried | Decision | Evidence index |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Unit | `COUNT` | `COUNT` | `COUNT` | `0` | `0` | `MARK` | `PATH` |
| Component | `COUNT` | `COUNT` | `COUNT` | `0` | `0` | `MARK` | `PATH` |
| Contract | `COUNT` | `COUNT` | `COUNT` | `0` | `0` | `MARK` | `PATH` |
| Integration | `COUNT` | `COUNT` | `COUNT` | `0` | `0` | `MARK` | `PATH` |
| Security | `COUNT` | `COUNT` | `COUNT` | `0` | `0` | `MARK` | `PATH` |
| Pair E2E round 1 | `COUNT` | `COUNT` | `COUNT` | `0` | `0` | `MARK` | `PATH` |
| Pair E2E round 2 | `COUNT` | `COUNT` | `COUNT` | `0` | `0` | `MARK` | `PATH` |

## Command Ledger

| Command ID | Command | Start local / UTC | Finish local / UTC | Duration | Exit | stdout/stderr | SHA-256 |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| `COMMAND_ID` | `COMMAND` | `LOCAL` / `UTC` | `LOCAL` / `UTC` | `DURATION_MS` | `EXIT_CODE` | `PATH` | `SHA256` |

## Case Ledger

| Case | Category | Requirement / acceptance | Round | Start local / UTC | Finish local / UTC | Result | Evidence |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| `CASE_ID` | `CATEGORY` | `REQUIREMENT_IDS` / `ACCEPTANCE_IDS` | `ROUND_OR_NA` | `LOCAL` / `UTC` | `LOCAL` / `UTC` | `PASS_OR_FAIL` | `PATH` |

## Browser Step Ledger

Each visible business state has one row. A missing expected artifact fails the step, case, round,
and overall mark. The administrator password is read from a mode-0600 fixture file and is never retained in
screenshots, traces, reports, URLs, or logs. Password login runs in the visible browser while secret values remain
outside the evidence set. The email callback runs in an ephemeral recording-disabled Chromium context; only its
safe pre/post evidence and digests are retained. A mode that does not capture trace, video, HAR, RPC, or SQL marks
that column `N/A`; it never substitutes a process log or checksum for unavailable evidence.

| Case / step | Expected | Actual | Viewport | Start local / UTC | Finish local / UTC | Screenshot | Trace | Video | HAR | RPC / SQL / logs | Request / command IDs | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CASE_ID / STEP_ID` | `EXPECTED` | `ACTUAL` | `WIDTHxHEIGHT` | `LOCAL` / `UTC` | `LOCAL` / `UTC` | `PATH#SHA256` | `PATH#SHA256` | `PATH#SHA256` | `PATH#SHA256` | `PATHS#SHA256` | `REQUEST_ID / COMMAND_ID` | `PASS_OR_FAIL` |

## Business State Verification

| Case / step | Pre-state | Operation | Post-state | RPC result | Bounded SQL state | Audit correlation | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `CASE_ID / STEP_ID` | `SUMMARY` | `COMMAND_OR_QUERY` | `SUMMARY` | `PATH` | `PATH` | `EVENT_ID` | `PASS_OR_FAIL` |

## Artifact Integrity

| Check | Result | Evidence |
| --- | --- | --- |
| Required artifacts present | `PASS_OR_FAIL` | `MANIFEST_PATH` |
| Ordered SHA-256 verification | `PASS_OR_FAIL` | `SHA256SUMS_PATH` |
| Secret scan | `PASS_OR_FAIL` | `SECRET_SCAN_PATH` |
| Manifest schema validation | `PASS_OR_FAIL` | `VALIDATION_PATH` |
| Exact process cleanup | `PASS_OR_FAIL` | `PROCESS_LEDGER_PATH` |

## Failures

| Case / step | Observed result | Expected result | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| `CASE_ID / STEP_ID` | `ACTUAL` | `EXPECTED` | `PATHS` | `OPEN_OR_FIXED_BEFORE_FORMAL_RUN` |

## Approval

| Role | Decision | Name | Local / UTC time | Notes |
| --- | --- | --- | --- | --- |
| Executor | `PASS_OR_FAIL` | `NAME` | `LOCAL` / `UTC` | `NOTES` |
| Reviewer | `PASS_OR_FAIL` | `NAME` | `LOCAL` / `UTC` | `NOTES` |
