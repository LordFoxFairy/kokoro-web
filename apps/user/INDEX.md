---
architectureIndex: 1
rootId: web.user
owners:
  - "@LordFoxFairy"
---

# User Web application

## Responsibilities
Render the Browser v3 reference Chat harness, own browser interaction state, and bridge authenticated users to Session HTTP/SSE through a server BFF.

## Non-responsibilities
The app does not own conversation persistence, execute Agent runs, decide credit/model policy, or call Agent directly.

## Public boundary
Next.js routes are the browser boundary; `src/lib/server` is the server-only BFF and `src/core`/`engine` define client state/event folding.

## Callers and dependencies
Site users call this app. Its BFF calls Session and the Site-scoped plan catalogue read endpoint; shared translation behavior comes from repository-local packages where adopted.

## Data ownership and events
The active harness owns only its composer draft and typed Chat projection. Session owns messages/runs/replay and Platform owns Site/account/entitlement facts.

## Runtime and security
Browser input is untrusted; cookies are sealed server-side, bearer/service credentials stay in the BFF, and trusted host resolution determines Site context.

## Idempotency, failure, and recovery
Message submission, optimistic reconciliation, SSE replay, snapshot hydration, HITL control receipts, and draft persistence cover reconnect and retries.

## Extension rules and forbidden dependencies
Add UI under focused `src/ui` components and remote access behind `src/lib/server`. Never add direct Platform DB, Agent HTTP, or client-selected Site authority.

## Current gotchas
This source is shared capability code; each production Site still requires an independent product-named project, lock, artifact, release, and rollback authority.
Web acquisition is intentionally shut down: there are no checkout/mock-pay routes, payment-provider secrets, purchase CTAs, or payment SDK initialization. Keep credit/account and plan catalogue views read-only; do not invent a redeem endpoint or generic commerce proxy.
The pre-v3 universal skin remains under explicit quarantine (see `LEGACY_QUARANTINE.md`) and is outside active TypeScript/Vitest surfaces; the root page may import only `src/reference/**`, not raw GA reducers or legacy billing/delivery/Hub/Team UI.

## Verification
Run user tests, lint, typecheck, production build, and Web-to-Session HTTP/SSE compatibility.
