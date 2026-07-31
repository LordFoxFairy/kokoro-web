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
  `getPersonalContext` subject read, strict local bootstrap composition, and browser-safe projection including only published
  per-surface model option catalogs (never provider/route/secret bindings).
- `session-access.ts`: compact-JWS, five-minute maximum `session.read|write|control|stream` grants; exact frozen binding validation,
  project/session/run resource scoping, and resource-keyed single-flight cache.
- `session-proxy.ts`: operation-bound proxy with browser authority rejection, request/response header allowlists, authenticated
  response binding checks, abort propagation, and pull-based SSE backpressure.
- `session-browser-v3.ts`: exact Root-generated browser operation registry, path/query/body adapters (including action/plan decisions),
  status-specific JSON/problem validators, complete SSE frame validation, and authenticated transport binding returned out-of-band.
- `index.ts`: the sole package export and a `server-only` guard. Site browser bundles must never import this package.

## Dependency direction

Root owns `exchangeProductContext`, `getPersonalContext`, and `issueSessionAccessGrant`. Consumers inject narrow adapters for those
generated operations; adapters must not introduce hand-written URLs, headers, or duplicate wire DTOs. ProductContext transport retries
reuse one command identity, while each cache refresh creates a new command/idempotency identity. Request-scoped ProductContext reads
propagate the caller AbortSignal/deadline and do not join an unscoped single-flight request. `SessionProxyTransportPort` adapts the
Root-generated Session browser v3 client by operation id; browser-provided arbitrary paths are structurally impossible.

## Security and runtime rules

- Binding identity comes only from explicit server/build configuration. Host, query, caller headers, defaults and local aliases are
  not inputs.
- Production rejects local-unsafe mode. Non-production unsafe mode still requires complete binding material and an explicit audit
  watermark; it does not bypass Platform exchange.
- ProductContext must echo binding, deployment, release, artifact, environment, region, audience and contract revision exactly; it
  contains no user. PersonalContext must echo ProductContext and bind the AuthSession subject/generation before local composition.
- Session grants are server-only, purpose/audience specific, at most five minutes, and bind issuer/key revision/not-before,
  all eight positive-uint64 epoch axes, Site/release/artifact/project/subject, and the exact project/session/run resource.
- Routes are server-declared operations with exact methods and status-to-response schemas. Browser Site/namespace/bearer/workload/
  generation authority is rejected recursively before operation parsing; every route passes a mandatory origin/CSRF verifier.
- The generated Session registry is the only operation/method/path/success-status/schema authority. The local purpose policy is an
  exhaustive compile-time map over that registry; non-success statuses use one bounded generated problem-envelope fallback.
- Every browser request, including reads and SSE, carries a verified same-origin proof. Trusted server callers use the separate
  server-only transport port and never emulate a headerless browser call.
- The Session transport returns the full authenticated grant binding out-of-band; response headers are never trusted as tenant evidence.
- The low-level authenticated HTTP request receives that exact already-verified binding from this trust kernel. A deployment adapter
  may return it only after establishing its registered authenticated upstream response; it must never derive it from response headers.
- JSON is bounded, decoded and validated before re-encoding. SSE adapters emit only complete validated frames, one downstream pull at a
  time, and abort upstream on disconnect/cancel. Credentials, cookies, internal headers and `Set-Cookie` are never proxied.

## Verification

- `pnpm --filter @kokoro/bff-runtime typecheck`
- `pnpm --filter @kokoro/bff-runtime build`
- `pnpm --filter @kokoro/bff-runtime test`
