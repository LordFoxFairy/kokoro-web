---
architectureIndex: 1
rootId: web.admin
owners:
  - "@LordFoxFairy"
---

# Admin Web application

## Responsibilities
Render operator workflows, own the encrypted browser-facing BFF session, and call privileged Platform APIs through server-only generated clients.

## Non-responsibilities
Admin Web does not own Platform tables, migrations, business transactions, public Site sessions, Agent execution, or acquisition/payment operations.

## Public boundary
Next.js routes/components are browser-facing; `lib/control-plane/**` is the only privileged Platform boundary.

## Callers and dependencies
Operators use the app. Refine owns resource lifecycle/query integration, Ant Design 5 and stable Pro Components own the UI primitives, and server code calls Platform Admin Connect through generated clients. Next.js remains the same-origin security BFF.

## Data ownership and events
The app owns only short-lived encrypted Web session state and UI caches. Platform owns identity, authority, offers, card inventory and receipts.

## Runtime and security
Workload credentials are lazy bounded private files, never browser/build-time data. The BFF uses HTTP/2 mTLS plus the opaque Platform session credential. Platform deliveries require exact RSA-OAEP-256/A256GCM and ES256 profiles, complete session epochs and signed scope-selection grants. The session retains bounded Site scopes and an independently granted global scope; every effect selects its required scope and Platform re-authorizes it. No deployment-fixed Site is trusted.

`apps/admin/Dockerfile` is the only fixed Admin production image boundary. Next standalone output is
copied without the workspace dependency tree and runs as UID/GID 10001 under the read-only contract in
`deployables.yaml`; only `/tmp` is writable. Exact unauthenticated `/api/health/live` and
`/api/health/ready` routes bypass the operator cookie proxy. Readiness loads the complete private-file
configuration and completes a bounded mTLS HTTP/2 settings exchange with Platform Admin; failures
return a stable 503 body without diagnostics.

## Idempotency, failure, and recovery
Admin effects use stable command IDs and generated canonical protobuf digests. Model mutations use a stateless prepare→execute protocol: prepare validates the full command and returns a bounded opaque reference containing its lowercase UUIDv4 identity and canonical digest without executing; the browser persists that reference before sending execute, but never persists the potentially 16 MiB command body. Execute decodes the same reference, reconstructs and reauthorizes the scope, recomputes the canonical digest, and rejects any body/identity mismatch before invoking Platform. The browser keeps at most one pending reference and blocks new Model writes. A lost execute response or page restart is recovered only through the authoritative receipt query. Only a successful committed receipt clears the reference; NotFound, timeout, invalid recovery, or operator confirmation cannot unlock a new effect. Card issuance never auto-replays an unknown delivery outcome.

## Extension rules and forbidden dependencies
Add exact resources to the closed Refine provider registry and domain workflows behind generated service methods. Never restore Prisma, `DATABASE_URL_ADMIN`, arbitrary URL data providers, manifest-driven forms, or generic resource/action proxies.

## Current gotchas
The typed P0 surface covers current operator, operator listing, one-User-within-Site identity lookup, pending approvals, Site registration/publication/query, scoped audit, the read-only Site Credit fact plane, and Model Control. Operators are the first real Refine resource and resolve only through the exact `/api/control/operators` registry entry with strict response validation; unsupported resources and mutations fail before network access. Generic manifest/resource/action/OpenAPI routes, Teams/Hub generic screens, and unimplemented Commerce/CreditProgram pages and routes are physically absent. SiteRelease certification accepts externally produced proof bytes and key references, never signing private keys. Commerce navigation returns only when its approved maker/checker provider and Commerce-owned Program catalog exist.

## Verification
Run Admin tests, lint, typecheck, standalone build, the Admin production-release repository gate, and
the Root-owned live compatibility scenario. CI additionally builds `apps/admin/Dockerfile` from the
Web repository root.
