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
Workload credentials are lazy bounded private files, never browser/build-time data. The BFF uses HTTP/2 mTLS plus the opaque Platform session credential. Platform deliveries require exact RSA-OAEP-256/A256GCM and ES256 profiles, complete session epochs and signed scope-selection grants. The deployment site is injected server-side and every Platform request re-authorizes current authority.

## Idempotency, failure, and recovery
Admin effects use stable command IDs and generated canonical protobuf digests. Non-secret mutations replay the exact command once after an ambiguous transport failure. Card issuance never auto-replays an unknown delivery outcome.

## Extension rules and forbidden dependencies
Add control-plane UI here and Platform behavior behind generated service methods. Never restore Prisma or `DATABASE_URL_ADMIN`.

## Current gotchas
The typed P0 surface covers current operator, operator listing, pending approvals, offer publication and code-batch issuance/lifecycle. Older generic resource screens remain outside this surface and must not be used to add Commerce operations.

## Verification
Run Admin tests, lint, typecheck, build, and the Root-owned live compatibility scenario.
