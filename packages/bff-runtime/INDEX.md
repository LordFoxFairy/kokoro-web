---
architectureIndex: 1
rootId: web.bff-runtime
owners:
  - "@LordFoxFairy"
---

# BFF runtime

## Responsibility

Brandless, server-only trust kernel shared by independently deployed Site BFFs. It loads one explicit deployment-bound
`SiteProjectBinding`, exchanges and caches a user-free ProductContext, separately reads a UserSession-bound PersonalContext, composes
the browser-safe bootstrap, acquires purpose-specific Session grants, and proxies generated Session operations without exposing
authority material to a browser.

## Public API

- `site-binding.ts`: explicit build/deployment binding, production unsafe-mode gate, `exchangeProductContext` command/cache,
  `getPersonalContext` subject read, strict local bootstrap composition, and browser-safe projection.
- `session-access.ts`: short-lived `session.read|write|control|stream` grant acquisition, validation, refresh, and single-flight cache.
- `session-proxy.ts`: operation-bound proxy with browser authority rejection, request/response header allowlists, authenticated
  response binding checks, abort propagation, and pull-based SSE backpressure.
- `index.ts`: the sole package export and a `server-only` guard. Site browser bundles must never import this package.

## Dependency direction

Root owns `exchangeProductContext`, `getPersonalContext`, and `issueSessionAccessGrant`. Consumers inject narrow adapters for those
generated operations; adapters must not introduce hand-written URLs, headers, or duplicate wire DTOs. ProductContext transport retries
reuse one command identity, while each cache refresh creates a new command/idempotency identity. `SessionProxyTransportPort` adapts the
Root-generated Session browser v3 client by operation id; browser-provided arbitrary paths are structurally impossible.

## Security and runtime rules

- Binding identity comes only from explicit server/build configuration. Host, query, caller headers, defaults and local aliases are
  not inputs.
- Production rejects local-unsafe mode. Non-production unsafe mode still requires complete binding material and an explicit audit
  watermark; it does not bypass Platform exchange.
- ProductContext must echo binding, deployment, release, artifact, environment, region, audience and contract revision exactly; it
  contains no user. PersonalContext must echo ProductContext and bind the AuthSession subject/generation before local composition.
- Session grants are server-only, purpose/audience specific, short lived, and bound to Site/release/artifact/project/subject/epochs.
- Routes are server-declared operations with exact methods and status-to-response schemas. Browser Site/namespace/bearer/workload/
  generation authority is rejected recursively before operation parsing; every route passes a mandatory origin/CSRF verifier.
- The Session transport returns the full authenticated grant binding out-of-band; response headers are never trusted as tenant evidence.
- JSON is bounded, decoded and validated before re-encoding. SSE adapters emit only complete validated frames, one downstream pull at a
  time, and abort upstream on disconnect/cancel. Credentials, cookies, internal headers and `Set-Cookie` are never proxied.

## Remaining provider integration

The owning generated mirrors must be refreshed from Root's expanded Platform Public contract, and Session browser v3 must provide the
operation-bound HTTP/SSE adapter, validators and authenticated full-grant response metadata. This package does not claim those provider
adapters already exist.

## Verification

- `pnpm --filter @kokoro/bff-runtime typecheck`
- `pnpm --filter @kokoro/bff-runtime build`
- `pnpm --filter @kokoro/bff-runtime test`
