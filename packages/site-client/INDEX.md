---
architectureIndex: 1
rootId: web.site-client
owners:
  - "@LordFoxFairy"
---

# Site client

## Responsibilities

Provides Root-generated Platform Public v1 types/metadata plus a contract-bound, server-only request executor for a Site BFF.

## Public boundary

- `@kokoro/site-client` exports safe generated types and immutable contract metadata only.
- `@kokoro/site-client/server` is guarded by `server-only` and exports the credential-bearing client/transport boundary.
- Every operation comes from the Root-generated registry. Body/path/query/final contract headers are parsed before transport, only declared success statuses are accepted, and malformed upstream payloads become stable protocol errors without leaking Zod internals.
- Effectful operations always receive the generated CSRF header. Command identity is attached only when supplied; the generated
  header schema decides whether it is required, so non-command effects such as Session grant issuance cannot acquire undeclared headers.

## Ownership and exclusions

The package never accepts a raw Platform URL and never selects a Site. A registered Site-server transport owns workload/session credential injection and maps the explicit receipt-recovery security field to the outbound request.

## Generated source

`src/generated/platform-public/*` is produced by Root contract authority and must not be hand edited. It is the Site-facing Platform Public client mirror.

## Verification

- `pnpm --filter @kokoro/site-client typecheck`
- `pnpm --filter @kokoro/site-client build`
