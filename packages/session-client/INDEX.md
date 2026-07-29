---
architectureIndex: 1
rootId: web.session-client
owners: ["@LordFoxFairy"]
---

# Session client

Brand-neutral client over Root-generated Session HTTP/SSE schemas. Callers inject a path-only transport; this package accepts no raw Session URL, Site identity, namespace, bearer token, or credential resolver.

The current legacy mirror is intentionally rejected for Chat hydration because it has optional flat messages and a numeric watermark. Wave 3 Task 2 must generate the complete typed snapshot and opaque cursor before this package can return `ready`.

SSE resume tokens are opaque and travel only in `Last-Event-ID`. Numeric/empty cursors fail closed; auth, conflict, contract, and repair outcomes remain distinct.

Verification: `pnpm --filter @kokoro/session-client typecheck && pnpm --filter @kokoro/session-client build`.
