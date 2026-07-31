---
architectureIndex: 1
rootId: web.site-runtime-node
owners: ["@LordFoxFairy"]
---

# Node Site runtime adapter

Server-only deployment adapter shared by independently built Site projects. It is the sole owner of registered Platform/Session origins, TLS 1.3 mTLS material, Platform CSRF, Site workload credential transport, deadlines, bounded Platform JSON and Session response streaming.

Business components receive only `PlatformPublicTransport`, `ArtifactDeliveryTransport`, and `AuthenticatedSessionBrowserV3HttpPort`. They cannot select an origin, forward browser authority, or reconstruct a Session binding. Artifact delivery uses one canonical authorization path, generated single-Range/deadline headers, server-only workload/capability credentials, AbortSignal propagation, a whole-stream timeout, and the Node/Web stream bridge without buffering or redirect following. The Session port returns the exact Platform-signed binding supplied by the trust kernel only after an authenticated upstream response is established; response headers never supply tenancy evidence.

`installNodeSiteRuntimeProviderFromEnv()` is called from Node instrumentation once per deployment process. Required values are server-only and certificate/key/CA values are loaded from bounded absolute files. Browser CSRF tokens are short-lived HMAC capabilities; Platform CSRF remains a distinct workload credential.

Verification: `pnpm --filter @kokoro/site-runtime-node lint && pnpm --filter @kokoro/site-runtime-node typecheck && pnpm --filter @kokoro/site-runtime-node test && pnpm --filter @kokoro/site-runtime-node build`.
