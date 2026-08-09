---
architectureIndex: 1
rootId: web.account-app
owners:
  - "@LordFoxFairy"
---

# @kokoro/account-app

Brand-neutral browser UI for Site registration, email verification, security sessions, Code redemption,
entitlements and credits. It calls only fixed same-origin Site BFF routes and never receives Platform/Site
authority, opaque credentials, recovery capabilities, preview credentials, Code inventory or internal refs.

Verification links carry the public transaction reference in the query/path and the one-time secret only in
the URL fragment. The client clears that fragment before dispatching the same-origin BFF request. Redemption
renders the safe preview and requires explicit acceptance whenever Platform returns authoritative term refs.
Registration requires a 15-character password, confirmation, and browser-safe legal labels/links from
`KOKORO_SITE_REGISTRATION_LEGAL_DOCUMENTS`; the shared strict parser derives authoritative server-only term refs
and browser-safe labels/links from that one SiteRelease projection. Redemption maps sealed preview refs through the same registry.

## Responsibilities

Provide the brand-neutral browser UI for registration, verification, account security, entitlement, credit, and Code-redemption journeys.

## Non-responsibilities

This package does not authenticate users, hold Platform or Site authority, inventory Codes, settle credit, or persist authoritative account and receipt state.

## Public boundary

`@kokoro/account-app` exposes the client-only product surface from `src/index.tsx`.

## Callers and dependencies

Generated Site projects mount the package against fixed same-origin Site BFF routes. It has no dependency on another Kokoro workspace package.

## Data ownership and events

Only bounded browser form and interaction state is local. Platform owns identity, terms, entitlements, credit, redemption, and durable command receipts.

## Runtime and security

Verification secrets remain in the URL fragment until cleared, raw Codes are one-hop inputs, and browser output is limited to the safe legal-document and preview projections.

## Idempotency, failure, and recovery

Effect requests retain their command identity across ambiguous transport results and reconcile through the Site BFF receipt or capability-recovery path.
Redemption confirmation keeps its one `flowRef` only in mounted component state, follows the owner `retryAfter`
through a bounded `/api/account/recover` poll, and refreshes Account facts only after a fulfilled `succeeded`
outcome. A timeout or network interruption keeps that flow available for explicit continuation; `rejected` and
`review_required` are terminal and never trigger a balance refresh. Only a fulfilled product outcome clears the
preview; reversed or reconciliation-required outcomes remain visibly fail-closed. The same overall deadline
aborts request bodies, polling waits, and recovery reads, while unmount or authority changes cancel the operation
and discard stale results. No browser persistence or second recovery protocol is used.

## Extension rules and forbidden dependencies

Keep UI and browser-safe validation under `src`. Do not import server-only packages, accept backend origins, retain raw Codes, or duplicate Platform policy.

## Current gotchas

Registration and redemption must resolve labels and authoritative term references from the same strict SiteRelease legal-document registry.

## Verification

Run `pnpm --filter @kokoro/account-app lint`, `pnpm --filter @kokoro/account-app typecheck`, and `pnpm --filter @kokoro/account-app test`.
