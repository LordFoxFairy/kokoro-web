---
architectureIndex: 1
rootId: web.memory-app
owners:
  - "@LordFoxFairy"
---

# Site Memory app

Brand-neutral Product Memory M0.1 controls for independently deployed Sites. The package owns the exact same-origin browser client, Site-scoped ambiguous-command journal, monotonic owner projection and accessible settings/list/detail/history/import/export/purge UI.

It consumes only the generated `platform-public-v1` mirror through `/api/memory`; Site, subject, Project, space and namespace never enter browser state or requests. Saved-memory use, past-chat reference and automatic learning remain visibly independent controls. M0.1 keeps the latter two unavailable and never sends mutation commands for them.

Correction and restore append revisions. Forget/reset expose immediate logical revoke and receipt-backed purge states; a purged revision cannot be restored. Import reuses the authorized Asset uploader and never asks a user to type owner refs. A ready export accepts only the BFF-projected exact same-origin Artifact delivery route. Content is bounded by canonical UTF-8 bytes and renders as React text, never raw HTML.

Every asynchronous projection captures a committed `(browserRuntimeScope, generation)` token. Selection, pagination, command
recovery, import/export refresh and Asset upload discard late results after a Site/user/release scope switch, including A→B→A,
or after same-scope auth/transport client rotation; abort remains resource cleanup rather than the correctness mechanism.
Within one runtime scope, a unified per-entry owner-knowledge fence retains the highest active version or a terminal revoked
tombstone across list refreshes and same-scope client/deep-link bootstrap. Active detail reads lift an existing list member without
inventing membership for an unlisted entry; revoked refs reject any later page that tries to reintroduce them. A genuinely new
runtime scope starts from a fresh owner bootstrap. Every succeeded entry/list mutation invalidates the prior pagination cursor, and
only a fully reconciled first page may publish a replacement cursor.

The package does not own Memory persistence, Session history, GA context use, Asset/Artifact bytes or Site feature enablement. `@kokoro/site-scaffold` is the build-time authority that either includes the complete package/page/BFF route in one Site artifact or omits them entirely.

## M0.1 contract boundary

M0.1 does not claim protected-category confirmation or navigable source actions. The current public contract exposes only a
non-navigable source summary (`sourceKind`, `safeLabel`, `state`), so this UI renders source provenance as text and never
turns an owner reference or arbitrary URL into a link. A successor Root contract must provide an opaque source-action
handle or closed same-origin path whose BFF exchange reauthorizes the current Site workload and user session.

The current remember/correct command contract also has no sensitivity classification, protected-category marker or
confirmation receipt. Platform policy remains the enforcement authority; Web must not infer protected content from text
or invent browser-only fields. A successor Root contract must define the protected-memory confirmation command sequence,
receipt lifecycle and safe rejection projection before Web can expose that flow.

Verification: `pnpm --filter @kokoro/memory-app lint && pnpm --filter @kokoro/memory-app typecheck && pnpm --filter @kokoro/memory-app test && pnpm --filter @kokoro/memory-app build`.

## Responsibilities

Provide brand-neutral saved-memory controls for the explicitly published Product Memory operation set.

## Non-responsibilities

This package does not classify content, learn automatically, search past chats, select runtime context, own memory records, or activate a dormant Platform surface.

## Public boundary

`@kokoro/memory-app` exposes the client-only Memory product composition from `src/index.ts`.

## Callers and dependencies

Only generated Sites that physically include Memory may mount it. The package depends on `@kokoro/asset-client` and `@kokoro/site-client`.

## Data ownership and events

Platform owns memory settings, records, history, restore, priority, import/export, and recovery facts. The browser owns bounded form and list projection state.

## Runtime and security

Every call is same-origin through the exact Site BFF Memory facade; Site, subject, project, space, namespace, and workload authority are server-derived.

## Idempotency, failure, and recovery

Mutations preserve command identity and expose only the same-origin recovery route after transport ambiguity. Reads replace local projection from authoritative results.

## Extension rules and forbidden dependencies

Keep behavior inside the frozen explicit operation set. Do not add past-chat, automatic-learning, ContextUse, Temporary Chat, direct Platform transport, or hidden runtime activation.

## Current gotchas

Physical inclusion in a Site artifact is necessary but not sufficient; the resolved Platform bootstrap must also publish the Memory surface.

## Verification

Run `pnpm --filter @kokoro/memory-app lint`, `pnpm --filter @kokoro/memory-app typecheck`, and `pnpm --filter @kokoro/memory-app test`.
