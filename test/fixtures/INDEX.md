---
architectureIndex: 1
rootId: web.test-fixtures
owners: ["@LordFoxFairy"]
---

# Web runtime fixtures

## Responsibility

`web-chat-credit-runtime.mjs` is the Web-owned child entry for the Root Web Chat/Credit compatibility scenario.
It packages the current production Site closure, consumes `@kokoro/site-scaffold` and `@kokoro/session-client`
only through public exports, and builds one independent generated Site candidate.

`web-chat-credit-runtime-network.mjs` owns ephemeral TLS, standalone asset placement, loopback proxying and the
bounded cookie-aware HTTPS client. `web-chat-credit-runtime-journey.mjs` owns the NextAuth and Session-client
adapters plus strict Dashboard admission. The main entry owns setup state, lifecycle and final evidence only.

## Contract

- `setup` builds the candidate, generates an ephemeral public proxy CA/server identity, and returns fixed
  endpoint/path metadata, the CA path, a private runtime-state path, and exact missing material names.
- `serve` copies `.next/static` into the standalone artifact, starts the generated `server.js` on loopback,
  and exposes it through a TLS 1.3 proxy that accepts only the immutable candidate Host.
- `exercise` performs the NextAuth credentials ceremony in one cookie jar, requires all three Account dashboard
  authorities, creates and submits through the same-origin Session BFF, decodes SSE through the production AG-UI
  client, waits for terminal settlement, replays the exact logical command, and writes one owner-safe result.
- `observe` reads that durable result and returns only bounded booleans and counts for Host resolution, the browser
  Session turn, terminal assistant output, two Account dashboard reads, Credit deltas, and reference filtering.
- Auth, upstream endpoint, workload, CSRF, mTLS, and Site HTTPS material stays in owner-provided private files.
  No credential, prompt, response content, amount, Usage ref, or Gateway ref is returned in setup/observe records.

## Boundaries

The fixture never imports sibling repositories, production package source paths, or `apps/reference-site`. It does
not create compatibility routes, alternate browser transports, Site/Session persistence, or Credit calculations.
Missing upstream/runtime authority remains fail-closed and cannot be converted into a passing observation.

## Verification

Run `pnpm exec node --test test/runtime/web-chat-credit-runtime.test.mjs` with Node 24.
