---
architectureIndex: 1
rootId: web.site-runtime-node
owners:
  - "@LordFoxFairy"
---

# Node Site runtime adapter

Server-only deployment adapter shared by independently built Site projects. It is the sole owner of registered Platform/Session origins, TLS 1.3 mTLS material, Platform CSRF, Site workload credential transport, deadlines, bounded Platform JSON and Session response streaming. Platform/Artifact and Session use separate CA trust roots and separate connection pools; the Site client identity certificate/key may be shared, but server trust is never merged or silently reused.

Business components receive only `PlatformPublicTransport`, `ArtifactDeliveryTransport`, and `AuthenticatedSessionBrowserV3HttpPort`. They cannot select an origin, forward browser authority, or reconstruct a Session binding. Platform JSON propagates caller cancellation through header and body consumption and applies one total deadline across connection plus bounded response parsing, capped by deployment policy. Artifact delivery uses one canonical authorization path, generated single-Range/deadline headers, server-only workload/capability credentials, AbortSignal propagation, a whole-stream timeout, and the Node/Web stream bridge without buffering or redirect following; a bodyless upstream 416 retains its exact unsatisfied-range owner size for downstream validation. The Session port returns the exact Platform-signed binding supplied by the trust kernel only after an authenticated upstream response is established; response headers never supply tenancy evidence.

`installNodeSiteRuntimeProviderFromEnv()` is called from Node instrumentation once per deployment process. Required values are server-only and certificate/key/CA values are loaded from bounded absolute files. Browser CSRF tokens are short-lived HMAC capabilities; Platform CSRF remains a distinct workload credential.

Verification: `pnpm --filter @kokoro/site-runtime-node lint && pnpm --filter @kokoro/site-runtime-node typecheck && pnpm --filter @kokoro/site-runtime-node test && pnpm --filter @kokoro/site-runtime-node build`.

## Responsibilities

Implement the registered Node transport provider for one Site deployment's Platform, Artifact, and Session connections.

## Non-responsibilities

This adapter does not resolve Sites, own product policy, authenticate browser users, define wire contracts, or accept caller-selected origins and credentials.

## Public boundary

`@kokoro/site-runtime-node` exposes the server-only provider installation and transport adapters from `src/index.ts`.

## Callers and dependencies

Generated Site instrumentation and `@kokoro/site-bff` consume the adapter. It depends on `@kokoro/bff-runtime` and `@kokoro/site-client`.

## Data ownership and events

The adapter owns process-local pools, deadlines, trust material handles, and browser-CSRF capability verification; it owns no business records or durable events.

## Runtime and security

TLS 1.3 mTLS, separate trust roots and pools, bounded files, registered origins, no redirects, total deadlines, cancellation, and streaming backpressure are mandatory.

## Idempotency, failure, and recovery

Transport preserves caller command identity and abort/deadline state. Pool or stream failure returns ambiguity to the owner workflow and never invents success.

## Extension rules and forbidden dependencies

Add transports only behind generated client ports. Do not merge trust roots, read browser-selected endpoints, trust response headers for tenancy, or buffer artifact bodies.

## Current gotchas

The Site client certificate may be shared across Platform and Session, but their CA roots and connection pools must remain separate.

## Verification

Run `pnpm --filter @kokoro/site-runtime-node lint`, `pnpm --filter @kokoro/site-runtime-node typecheck`, `pnpm --filter @kokoro/site-runtime-node test`, and `pnpm --filter @kokoro/site-runtime-node build`.
