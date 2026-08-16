# Admin Web Test Authority

`catalog/p0.yaml` is the executable P0 inventory. Every case has one stable ID, one category, its
PRD requirement and acceptance mappings, one executable test file for Admin-owned cases, expected
evidence, zero retries, and an explicit status.

## Categories

| Category | Responsibility | Runtime |
| --- | --- | --- |
| `unit` | Pure config, validation, mapping, cookie, Adapter, command, and pagination behavior | Vitest Node |
| `component` | Real rendered Admin UI states, interaction, accessibility, and 360px behavior | Vitest jsdom + Testing Library |
| `contract` | Toolchain, frozen Proto, generated clients, imports, i18n, build, and listener boundaries | Vitest Node |
| `integration` | Auth.js routes and Admin BFF behavior against local ConnectRPC listeners and protocol-shaped collaborators | Vitest Node |
| `security` | Enumeration, redirects, route authorization, tenant/owner protection, headers, hostile input, and leakage | Vitest Node |
| `pair_e2e` | Production Admin Web with the accepted IAM candidate, fresh PostgreSQL, Mailpit, and visible Chromium | Playwright + real services |

## Commands

```bash
pnpm --filter @kokoro/admin-web test:catalog
pnpm --filter @kokoro/admin-web test:unit
pnpm --filter @kokoro/admin-web test:component
pnpm --filter @kokoro/admin-web test:contract
pnpm --filter @kokoro/admin-web test:integration
pnpm --filter @kokoro/admin-web test:security
pnpm --filter @kokoro/admin-web verify
pnpm --filter @kokoro/admin-web acceptance
pnpm --filter @kokoro/admin-web acceptance:pair
```

## Formal Acceptance Rules

- All P0 cases execute; no skip, todo, only, retry, or test-name substitution is accepted.
- Admin repository acceptance precedes pair E2E acceptance.
- Pair acceptance consists of two complete rounds with distinct databases, credentials, mailboxes,
  browser contexts, and evidence roots.
- Formal pair journeys use a visible Chromium window so each business operation can be observed.
- Every business step records local and UTC start/finish times, timezone offset, duration, screenshot,
  trace, video, HAR, correlated Web/IAM/RPC/SQL evidence, request/command IDs, and SHA-256 values.
- The Magic Link callback is executed in an ephemeral recording-disabled context. Its Session cookie
  is transferred only in memory; verification URLs, tokens, and cookie values are never retained.
- Missing evidence or a failed integrity/secret scan marks the case, round, and overall result failed.
- Accepted artifacts and reports remain inside this repository under `reports/`; no central system
  test repository owns them.

Use `reports/templates/acceptance-report.md` as the report structure. Task 9 implements the immutable
repository runner; Task 10 implements the two-round pair runner and per-step evidence manifest.
