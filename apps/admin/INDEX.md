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
`lib/refine/admin-data-provider.ts` is the browser-side resource boundary. Its closed registry exposes the
four operational resources (`operators`, `sites`, `approvals`, `audit`) and five Site-scoped Commerce resources
(`credit-programs`, `entitlement-templates`, `offers`, `redemption-programs`, `code-batches`). Every resource maps
to exact same-origin BFF routes and validates every response before Refine receives it. Sites and all five Commerce
resources support exact detail reads; Commerce detail reads require the selected Site in provider metadata.

## Callers and dependencies
Operators use the app. Refine owns resource lifecycle/query integration, Ant Design 5 and stable Pro Components own the UI primitives, and server code calls Platform Admin Connect through generated clients. Next.js remains the same-origin security BFF.

## Data ownership and events
The app owns only short-lived encrypted Web session state and UI caches. Platform owns identity, authority, offers, card inventory and receipts.
Raw card codes are the sole exception to normal UI data flow: the first committed Issue response is held only in
the mounted Code Batch component's local state. It never enters Refine/React Query, notifications, URL state,
browser storage, logs or the clipboard. The blocking export dialog offers an explicit Blob download, revokes the
object URL immediately, and clears the local value on download, close, unmount or a 45-second timeout.

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
Admin Query tokens are bounded at 1024 characters; AdminCommerce HMAC tokens are bounded at 2048 characters.
The provider and BFF validate only the token envelope length and pass the token byte-for-byte without decoding,
constructing, or modifying its family/Site/scope/watermark payload.
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

AdminCommerce writes have one exact BFF route per resource or batch transition. A dynamic `[action]` dispatcher is
forbidden. Read permission, write permission, selected Site, state transition eligibility and the independent
Code Batch checker rule remain explicit in `lib/commerce-permissions.ts`; Platform rechecks all authority.

## Current gotchas
The typed surface covers current operator, operator listing, one-User-within-Site identity lookup, pending approvals,
Site registration/publication/query, scoped audit, the read-only Site Credit fact plane, Model Control, and the
canonical 20-RPC Site-scoped AdminCommerce owner. Commerce publishes immutable Credit Program, Entitlement
Template, Offer and Redemption Program revisions and manages Code Batch issue/approve/activate/abandon/suspend/
revoke transitions. Issue replays never redeliver secrets: the operator must abandon the old batch and use a new
batch plus a new command. Suspension cannot be resumed and can only move to revoked. Generic manifest/resource/
action/OpenAPI routes, dynamic action dispatch, Teams/Hub generic screens, the retired 39-RPC descriptor inventory,
and delivery-session compatibility entry points are physically absent.

## Verification
Run Admin tests, lint, typecheck, standalone build, the Admin production-release repository gate, and
the Root-owned live compatibility scenario. CI additionally builds `apps/admin/Dockerfile` from the
Web repository root.
