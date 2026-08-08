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
`lib/refine/admin-data-provider.ts` is the browser-side resource boundary: its closed registry exposes only
`operators`, `sites`, `approvals`, and `audit`, maps them to exact same-origin BFF routes, and validates every
response before Refine receives it. `sites` additionally supports the exact resource detail read.

## Callers and dependencies
Operators use the app. Refine owns resource lifecycle/query integration, Ant Design 5 and stable Pro Components own the UI primitives, and server code calls Platform Admin Connect through generated clients. Next.js remains the same-origin security BFF.

## Data ownership and events
The app owns only short-lived encrypted Web session state and UI caches. Platform owns identity, authority, offers, card inventory and receipts.

## Runtime and security
Workload credentials are lazy bounded private files, never browser/build-time data. The BFF uses HTTP/2 mTLS plus the opaque Platform session credential. Platform deliveries require exact RSA-OAEP-256/A256GCM and ES256 profiles, complete session epochs and signed scope-selection grants. The session retains bounded Site scopes and an independently granted global scope; every effect selects its required scope and Platform re-authorizes it. No deployment-fixed Site is trusted.

Anonymous `/login` and `/auth/verify` renders do not start current-operator or Site-catalog reads. Entering either
public route invalidates any older catalog request generation while leaving the Platform-owned OIDC flow intact.

`apps/admin/Dockerfile` is the only fixed Admin production image boundary. Next standalone output is
copied without the workspace dependency tree and runs as UID/GID 10001 under the read-only contract in
`deployables.yaml`; only `/tmp` is writable. Exact unauthenticated `/api/health/live` and
`/api/health/ready` routes bypass the operator cookie proxy. Readiness loads the complete private-file
configuration and completes a bounded mTLS HTTP/2 settings exchange with Platform Admin; failures
return a stable 503 body without diagnostics.

## Idempotency, failure, and recovery
Admin effects use stable command IDs and generated canonical protobuf digests. Model mutations use a stateless prepare→execute protocol: prepare validates the full command and returns a bounded opaque reference containing its lowercase UUIDv4 identity and canonical digest without executing; the browser persists that reference before sending execute, but never persists the potentially 16 MiB command body. Execute decodes the same reference, reconstructs and reauthorizes the scope, recomputes the canonical digest, and rejects any body/identity mismatch before invoking Platform. The browser keeps at most one pending reference and blocks new Model writes. A lost execute response or page restart is recovered only through the authoritative receipt query. Only a successful committed receipt clears the reference; NotFound, timeout, invalid recovery, or operator confirmation cannot unlock a new effect. Card issuance never auto-replays an unknown delivery outcome.

Resource lists use the opaque BFF `pageToken` contract instead of translating cursors into offset page numbers.
Approval records use the owner-qualified public identity `(owner, approvalRef)` from the generated Admin Query
contract. The BFF preserves `owner`, and Refine keys each row as `${owner}:${approvalRef}`; a UUID is never treated
as globally unique across approval owners.
The provider fixes `pageSize` at 100, returns `cursor.next` to Refine `useInfiniteList`, and accepts only the
initial page or the opaque continuation token that Refine passes back at runtime. Resource pages retain loaded
rows and expose explicit load-more controls without fabricating an offset or global total. Every infinite query
uses the provider's explicit next-cursor selector, so a terminal page never falls back to Refine numeric paging.
The shared cumulative window rejects repeated page params or next cursors, duplicate record IDs, more than 20
pages, more than 1000 records, and any continuation at either limit; list pages render no cached records after
such an error. The overview reports an exact pending count only for a terminal first page and otherwise shows a
lower bound. Hand-written BFF and
browser schemas accept the canonical 1024-character Admin Query cursor limit. Approvals and Audit accept only
the exact optional `siteId = eq` Refine filter; unsupported pagination, filters, sorters, resources, and mutations
fail before network access. The App shell's Site selector separately materializes its small bounded catalog while
reusing the provider's exact Operator and Site list schemas.

## Extension rules and forbidden dependencies
Add exact resources to the closed Refine provider registry and domain workflows behind generated service methods. Never restore Prisma, `DATABASE_URL_ADMIN`, arbitrary URL data providers, manifest-driven forms, or generic resource/action proxies.

## Current gotchas
The typed P0 surface covers current operator, operator listing, one-User-within-Site identity lookup, pending approvals, Site registration/publication/query, scoped audit, the read-only Site Credit fact plane, and Model Control. Operators, Sites, Approvals, and Audit are real Refine resources backed only by exact typed BFF routes; the overview pending count consumes the same validated Approvals resource instead of maintaining a second response schema. Generic manifest/resource/action/OpenAPI routes, Teams/Hub generic screens, and unimplemented Commerce/CreditProgram pages and routes are physically absent. SiteRelease certification accepts externally produced proof bytes and key references, never signing private keys. Commerce navigation returns only when its approved maker/checker provider and Commerce-owned Program catalog exist.

## Verification
Run Admin tests, lint, typecheck, standalone build, the Admin production-release repository gate, and
the Root-owned live compatibility scenario. CI additionally builds `apps/admin/Dockerfile` from the
Web repository root.
