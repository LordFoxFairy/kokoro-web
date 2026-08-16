# Kokoro Admin Web

Next.js browser BFF and Ant Design Pro operations console for `kokoro-iam`.

## Runtime

- App Router owns public `/login` and `/auth/verify`, protected control routes, and `/api/auth/*`.
- Auth.js owns Magic Link, CSRF, callback, cookie, and database Session mechanics.
- The complete Auth.js Adapter and protected operations call IAM through generated ConnectRPC
  descriptors and narrow server-only clients.
- `app/(control)/layout.tsx` resolves the current active platform administrator before rendering the
  shell. The Overview performs an actor-token exchange as live IAM readiness evidence.
- Protected business routes include `/users`, `/users/[userId]`, `/sessions`, `/organizations`,
  `/organizations/[organizationId]`, `/access`, and `/audit`.
- Overview reports live IAM readiness and the ten most recent SecurityEvents without deriving totals
  from paginated lists.
- Admin Web owns no database, SQL, Prisma client, gateway proxy, or browser-visible IAM token.

## Environment

Use this package's ignored `.env.local`; runtime code does not read a parent workspace environment
file. Start from `.env.example` and set:

```text
AUTH_URL
AUTH_SECRET_FILE
AUTH_SECURE_COOKIES
KOKORO_IAM_BASE_URL
KOKORO_IAM_ADMIN_WEB_TOKEN_FILE
MAGIC_LINK_MAX_AGE
EMAIL_FROM
EMAIL_SERVER_HOST
EMAIL_SERVER_PORT
```

`EMAIL_SERVER_USER` and `EMAIL_SERVER_PASSWORD_FILE` are an optional exact pair. Secret paths must
be absolute, normalized, owned regular files with exact mode `0600`. Production requires HTTPS and
secure cookies. Local HTTP endpoints must use loopback hosts; the browser origin is
`http://localhost:3100`.

## Commands

Run from the `kokoro-web` repository root:

```bash
pnpm --filter @kokoro/admin-web dev --port 3100
pnpm --filter @kokoro/admin-web proto:check
pnpm --filter @kokoro/admin-web test
pnpm --filter @kokoro/admin-web typecheck
pnpm --filter @kokoro/admin-web lint --max-warnings=0
pnpm --filter @kokoro/admin-web build
pnpm --filter @kokoro/admin-web verify
```

Formal repository and IAM-pair acceptance use `acceptance` and `acceptance:pair`. Their catalog,
rules, report template, screenshots, timestamps, hashes, and final evidence remain under this app's
`test/` and `reports/` trees.

The frozen Provider binds every Member mutation to its Organization and exposes administrator-only
selected-User authorization inspection. Access results contain the inspected User and Organization,
not the administrator's Session identity. Real pair evidence remains required for product release.

## Structure

- `contracts/iam/` and `generated/iam/`: frozen provider contract and deterministic generated code.
- `server/`: Node-only config, Auth.js, IAM transport/client, and safe logging boundaries.
- `app/(public)/`: public enumeration-safe authentication UI.
- `app/(control)/`: authenticated management routes.
- `components/`, `i18n/`, `lib/theme.ts`: reusable Admin-owned UI foundation.
- `docs/`: PRD, technical design, ADR, and implementation plan.
- `test/`, `reports/`, `scripts/test/`: classified verification and repository-owned evidence.

Read [INDEX.md](INDEX.md) before changing package boundaries.
