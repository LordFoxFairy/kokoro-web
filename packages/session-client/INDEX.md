---
architectureIndex: 1
rootId: web.session-client
owners: ["@LordFoxFairy"]
---

# Session client

Brand-neutral client over Root-generated Session HTTP/SSE schemas. Callers inject a path-only transport; this package accepts no raw Session URL, Site identity, namespace, bearer token, or credential resolver.

The Root-generated Session browser v3 mirror is live. The client exposes the complete browser command surface, validates the full projection snapshot, and hydrates only from its opaque snapshot watermark.

SSE resume tokens are opaque and travel only in `Last-Event-ID`. Numeric/empty cursors, event/id/cursor mismatches, epoch/order gaps, and sequence reuse under another event identity fail closed. `stream.draining` remains a non-durable control frame; auth, conflict, contract, and repair outcomes remain distinct.

Verification: `pnpm --filter @kokoro/session-client lint && pnpm --filter @kokoro/session-client typecheck && pnpm --filter @kokoro/session-client test && pnpm --filter @kokoro/session-client build`.
