---
architectureIndex: 1
rootId: web.reference-site
owners:
  - "@LordFoxFairy"
---

# Reference Site

## Purpose

Compile-time fixture for the independent Site app kit, generated client metadata and Next.js 16 packaging shape. It is not a production multi-Site host.

## Boundaries

One project has one package identity, Site key, immutable release, domain binding and rollback authority. Browser code may import only safe `@kokoro/site-client` metadata/types; credential-bearing calls belong in a server-only BFF through `@kokoro/site-client/server`.

The fixture signature and `.invalid` domain are intentionally non-production. This app does not prove live Platform activation, account/cookie isolation, auth journeys, Session chat, deployment or rollback.

## Legacy status

`apps/user` remains the existing Host-routed legacy app until Platform cutover. This fixture does not silently replace or qualify it.

## Verification

- `pnpm --filter @kokoro/reference-site typecheck`
- `pnpm --filter @kokoro/reference-site build`
