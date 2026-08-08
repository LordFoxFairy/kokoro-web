---
architectureIndex: 1
rootId: web.reference-site
owners:
  - "@LordFoxFairy"
---

# Reference Site

## Responsibilities

Compile-time fixture for the independent Site app kit, generated client metadata and Next.js 16 packaging shape. It is not a production multi-Site host.

## Public boundary

One project has one package identity, Site key, immutable release, domain binding and rollback authority. Browser code may import only safe `@kokoro/site-client` metadata/types; credential-bearing calls belong in a server-only BFF through `@kokoro/site-client/server`.

The fixture signature and `.invalid` domain are intentionally non-production. This app does not prove live Platform activation, account/cookie isolation, auth journeys, Session chat, deployment or rollback.

## Current gotchas

This fixture qualifies the shared Site composition only. Production Sites are generated as independent projects and never deploy this fixture.

## Verification

- `pnpm --filter @kokoro/reference-site typecheck`
- `pnpm --filter @kokoro/reference-site build`

## Non-responsibilities

This fixture does not serve production traffic, resolve arbitrary Sites, own authentication or Session state, or qualify live activation and rollback.

## Callers and dependencies

Repository CI and Site-factory developers build this app. It depends only on `@kokoro/site-app-kit` and the browser-safe surface of `@kokoro/site-client`.

## Data ownership and events

The fixture owns no business records or durable events. Its fixed manifest and `.invalid` identity exist only to prove compilation and packaging.

## Runtime and security

Next.js renders one fixed non-production Site shape. Credential-bearing Platform calls remain behind `@kokoro/site-client/server`; browser code receives only safe metadata and types.

## Idempotency, failure, and recovery

Builds are effect-free and repeatable. A failed build publishes no Site artifact and recovery is a clean rebuild from the same pinned workspace inputs.

## Extension rules and forbidden dependencies

Exercise shared Site packages here without adding production routing, multi-Site dispatch, secrets, direct sibling-repository source imports, or app-only copies of shared behavior.
