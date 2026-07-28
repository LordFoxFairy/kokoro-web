# Kokoro Admin Web

Next.js BFF and Ant Design Pro operations console for Kokoro Platform.

## Runtime

- Next.js App Router renders the console and owns Auth.js magic-link login.
- `/api/auth/*` is handled by Auth.js.
- Transparent `/api/*` requests use enumerated same-origin rewrites to `kokoro-platform-admin`; manifests, module OpenAPI, billing overview, user360, generic resources, and generic actions use local Route Handlers so acquisition and module-allowlist policy is enforced before gateway egress.
- Middleware first removes every browser-supplied `x-kokoro-*` header, then injects the Auth.js email and required server-only `x-kokoro-proxy-secret`; missing identity/secret fails closed. Local handlers revalidate that secret before egress. platform-admin remains the authority for RBAC, tenant scope, approval, and audit.
- Auth.js resolves operators, verification tokens, and auth events through the generated server-only `AdminAuthService` Connect client. This app has no Platform database credential or Prisma client.

## Environment

Copy `.env.example` to `.env.local` and fill real values.

Important local defaults:

- `AUTH_URL` must match the browser host used for login, for example `http://localhost:3000`.
- `KOKORO_GATEWAY_URL` points to platform-admin, usually `http://127.0.0.1:4290`.
- `KOKORO_ADMIN_PROXY_SECRET` must match one value in platform-admin `KOKORO_ADMIN_PROXY_SECRETS`.
- SMTP may be omitted in development; magic links print to the server console.

## Commands

```bash
pnpm --filter @kokoro/admin-web dev
pnpm --filter @kokoro/admin-web test
pnpm --filter @kokoro/admin-web lint
pnpm --filter @kokoro/admin-web typecheck
pnpm --filter @kokoro/admin-web build
pnpm --filter @kokoro/admin-web compat:admin-auth # Root live-compatibility harness only
```

## Data Boundary

This package owns no Platform data or migrations. Platform Admin owns operator lookup, one-time verification-token lifecycle, command receipts, and auth-event persistence. Generated protobuf descriptors are checked in under `lib/generated/contracts`; application code must not import contract source or sibling repositories.

The local acquisition boundary deeply allowlists manifest, credit-overview, and user360 response fields, normalizes non-2xx envelopes, and caps action requests at 16 MiB and gateway JSON responses at 8 MiB using both `Content-Length` preflight and streaming hard limits. Module OpenAPI uses its own fixed non-payment allowlist, 2 MiB streaming cap and 5 second deadline; the BFF authenticates the operator boundary while Platform enforces `docs.read`.
