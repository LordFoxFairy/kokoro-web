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
adapters plus strict Dashboard admission. `web-chat-credit-runtime-browser.mjs` owns the one real Chromium
Account redemption journey. The main entry owns setup state, lifecycle and final evidence only.

## Contract

- `setup` builds the candidate, generates an ephemeral public proxy CA/server identity, and returns fixed
  endpoint/path metadata, the CA path, a private runtime-state path, and exact missing material names.
- `serve` copies `.next/static` into the standalone artifact, starts the generated `server.js` on loopback,
  exposes it through a TLS 1.3 proxy that accepts only the immutable candidate Host, scans bounded child output
  without forwarding it, and writes lifecycle evidence only after proxy and child closure.
- `exercise` performs the NextAuth credentials ceremony in one cookie jar, requires all three Account dashboard
  authorities, creates and submits through the same-origin Session BFF, decodes SSE through the production AG-UI
  client, waits for terminal settlement, then replays the exact logical command. A live SSE terminal deadline reports
  `WEB_FIXTURE_SESSION_TERMINAL_TIMEOUT`; a later snapshot/cost-settlement deadline reports the distinct
  `WEB_FIXTURE_SESSION_SNAPSHOT_TIMEOUT`. Replay validation preserves the
  operation/command/idempotency/digest identity against the submitted command and preserves the immutable effect
  payload, while allowing only `accepted -> applied` with a non-regressing canonical UTC-millisecond owner timestamp
  or an exactly immutable `applied -> applied` replay. It then drives the generated `/account`
  page through preview, one committed confirmation whose response is transport-faulted, and the real
  `Continue confirmation result` UI using the same flow. Only a successful confirmation response is replaced by
  the intentional malformed response. A non-success confirmation response is continued exactly once and rejects
  with a fixed non-sensitive fixture code; a missing confirmation response and confirmation CDP teardown are each
  bounded by the Chromium action deadline. A primary confirmation failure remains authoritative if CDP teardown
  also fails. It writes journey evidence and returns only a bounded exercised receipt.
- `observe` remains unavailable until both journey and lifecycle evidence exist, then returns only bounded booleans
  and counts for Host resolution, the browser Session turn, terminal assistant output, Chat and three redemption
  Account reads, two execute requests, one UI recovery request, Credit/Product readback, replay stability, pinned
  TLS, removed browser profile, secret confinement, zero browser console/page errors, and reference filtering.
- Auth, upstream endpoint, workload, CSRF, mTLS, and Site HTTPS material stays in owner-provided private files.
  The raw redemption Code is reopened with no-follow identity checks from its exact `0600` file, exists transiently
  in the Account form and the single preview execute request, and never enters fixture state, URLs, output, logs,
  browser application storage/profile, or setup/observe records. Chromium trusts only the generated leaf SPKI and
  its private persistent profile is inspected, removed, and verified absent before journey evidence closes. No
  credential, prompt, response content, amount, Usage ref, or Gateway ref is returned in setup/observe records.

## Boundaries

The fixture never imports sibling repositories, production package source paths, or `apps/reference-site`. It does
not create compatibility routes, alternate browser transports, Site/Session persistence, or Credit calculations.
Missing upstream/runtime authority remains fail-closed and cannot be converted into a passing observation.
Chromium calls only the generated Site's existing same-origin Account pages and BFF routes; it adds no protocol,
worker, task system, or operational surface.

## Verification

Install the browser required by the pinned package with `pnpm exec playwright install chromium` before a local
real compatibility run; CI performs this explicitly because dependency installation does not install Chromium.
Run `pnpm exec node --test test/runtime/web-chat-credit-runtime-browser-fault.test.mjs` for the pure CDP lifecycle
regressions and `pnpm exec node --test test/runtime/web-chat-credit-runtime.test.mjs` for the full fixture with Node 24.
