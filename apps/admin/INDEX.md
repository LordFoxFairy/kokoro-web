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
Operators use the app; server code calls Platform Admin Connect and consumes `@kokoro/i18n`.

## Data ownership and events
The app owns only short-lived encrypted Web session state and UI caches. Platform owns identity, authority, offers, card inventory and receipts.

## Runtime and security
Workload credentials are lazy bounded private files, never browser/build-time data. The BFF uses HTTP/2 mTLS plus the opaque Platform session credential. Platform deliveries require exact RSA-OAEP-256/A256GCM and ES256 profiles, complete session epochs and signed scope-selection grants. The session retains bounded Site scopes and an independently granted global scope; every effect selects its required scope and Platform re-authorizes it. No deployment-fixed Site is trusted.

## Idempotency, failure, and recovery
Admin effects use stable command IDs and generated canonical protobuf digests. Model mutations propagate one lowercase UUIDv4 command ID as the transport request ID. An ambiguous outcome returns one bounded opaque recovery reference; the browser persists at most one pending reference, blocks new Model writes, and sends only that reference to the BFF for a later authoritative receipt query. The BFF reconstructs and reauthorizes the original operation/scope instead of issuing a new command. Card issuance never auto-replays an unknown delivery outcome.

## Extension rules and forbidden dependencies
Add control-plane UI here and Platform behavior behind generated service methods. Never restore Prisma or `DATABASE_URL_ADMIN`.

## Current gotchas
The typed P0 surface covers current operator, operator listing, one-User-within-Site identity lookup, pending approvals, Site registration/publication/query, scoped audit, offer publication, code-batch issuance/lifecycle, the read-only Credit fact plane, and Model Control. Credit reads use the generated AdminCredit contract and exact GET-only BFF routes; the console exposes accounts, grants, holds, allocations, journal facts, and rated usage without forwarding evidence or provider payloads. Each visible Credit/User surface is independently gated by the Platform-aligned permission matrix, and the server repeats that decision from the verified authority session before RPC. Generic manifest, resource, action, and OpenAPI routes fail closed for Credit and Model; Model administration uses only `/api/control/models`, and the retired billing overview and User360 fan-out routes do not exist. SiteRelease certification signatures come from external CI/release authority; Admin accepts proof bytes and key references, never signing private keys. Older generic resource screens remain outside this surface and must not be used to add Site, Commerce, Credit, Model, or identity operations.

## Verification
Run Admin tests, lint, typecheck, build, and the Root-owned live compatibility scenario.
