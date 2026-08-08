---
architectureIndex: 1
rootId: web.media-app
owners:
  - "@LordFoxFairy"
---

# Site media app

Brand-neutral Studio and Library product factory for independently deployed Sites. It owns minimal React composition, same-origin browser calls, and command-identity-only reconciliation records; it does not own media operations, artifacts, costs, project selection, or delivery capability.

Studio consumes Site-published definitions and model options, hard-validates the active input against the published candidate/aspect/format/prompt bounds, requires a non-binding quote before submit, and uses exact submit/cancel/recover/list/get BFF operations. Library renders Artifact owner list/version/availability and uses BFF content URLs only for exact `ready` versions. Restricted and unavailable retain typed safe failures; processing and deleted never acquire a URL.

Every BFF success payload is parsed with the generated Platform Public runtime schema and correlated to the requested definition, revision, command, operation, artifact, or version before it can enter React state. Publication changes reconcile the entire Studio draft atomically and invalidate old quotes. Submit receipts and recovery results must echo the exact generated caller-request fingerprint. Command recovery uses one Site-scoped local-storage key per command, canonical ISO timestamps, a 20-entry fail-closed capacity, and a 24-hour TTL; it never rewrites a shared cross-tab array or evicts an unresolved command. Any unresolved submit gates the next create effect. Denied browser storage fails closed with a recoverable UI error.

Library first-page reads, exact Artifact deep links, and Artifact/Version continuation pages are separate bounded owner calls. A deep link is resolved through the exact owner endpoint even when the Artifact is outside the first page; same-scope deep-link navigation immediately generation-fences and clears the prior owner before the new exact read, so a failed lookup cannot render stale content under the new URL. Refresh and polling merge monotonically, preserve already loaded continuation-page identities, and reject conflicting owner facts. Every continuation is generation-fenced against selection and Site-scope changes. Transient polling warnings are isolated from action failures and clear only after a later fully successful polling batch.

Platform responses are exhaustively projected into the owner unions exported by `@kokoro/chat-surface`, so Chat, Studio, and Library render one owner-state read model without a parallel Generation/Job abstraction. Studio renders typed partial, irreconcilable, reconciling, canceled and per-candidate outcomes instead of flattening them into progress; a ready candidate deep-links only to its exact Artifact in Library. Each generated Site injects its own brand name, browser runtime scope, CSRF, and theme while retaining an independent Web project, artifact, deployment, and domain. Studio and Library atomically hide/reset prior-scope state; every bootstrap, action, selection, recovery, and polling request is abortable and generation-fenced so an abort-insensitive stale completion cannot mutate the next account/project scope. Owner-version refresh is monotonic and conflicting same-version/immutable facts fail loud. Library polls only a selected Artifact with a processing version while the document is visible, then stops at ready/restricted/unavailable/deleted. Preview loading/failure/retry and download-request state remain on the same-origin BFF port; no capability or storage locator enters React state.

Verification: `pnpm --filter @kokoro/media-app lint && pnpm --filter @kokoro/media-app typecheck && pnpm --filter @kokoro/media-app test && pnpm --filter @kokoro/media-app build`.

## Responsibilities

Provide brand-neutral Studio and Library browser composition over published Media and Artifact product contracts.

## Non-responsibilities

This package does not choose providers, settle credit, issue artifact capabilities, persist operations, or expose private object-store locations.

## Public boundary

`@kokoro/media-app` exposes the client-only Studio and Library composition from `src/index.ts`.

## Callers and dependencies

Generated Site projects mount enabled media surfaces. The package depends on `@kokoro/chat-surface` and `@kokoro/site-client`.

## Data ownership and events

Platform owns definitions, operations, artifacts, and credit facts. The browser owns only filters, forms, safe operation projections, and display state.

## Runtime and security

The product uses same-origin Site BFF routes, generated references, bounded metadata, and artifact handles; provider routes, capabilities, and storage URLs remain server-only.

## Idempotency, failure, and recovery

Submit and cancel retain stable command identities, while operation reads recover authoritative status after ambiguous responses.

## Extension rules and forbidden dependencies

Add a media surface only through a published product contract and the shared projection model. Do not create generic Platform proxies or import server-only transports.

## Current gotchas

Chat orchestration and dedicated generation routes are separate Platform authorities even when Studio displays both in one operation journey.

## Verification

Run `pnpm --filter @kokoro/media-app lint`, `pnpm --filter @kokoro/media-app typecheck`, and `pnpm --filter @kokoro/media-app test`.
