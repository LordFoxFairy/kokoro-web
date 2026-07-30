---
architectureIndex: 1
rootId: web.session-client
owners: ["@LordFoxFairy"]
---

# Session client

Brand-neutral client over Root-generated Session HTTP/SSE schemas. Callers inject a path-only transport; this package accepts no raw Session URL, Site identity, namespace, bearer token, or credential resolver.

The Root-generated Session browser v3 mirror is live. The client exposes the complete browser command surface, including typed action/plan decisions and receipt reconciliation, validates the full projection snapshot, and hydrates only from its opaque snapshot watermark.
The generated HTTP mirror carries the full durable part union, including reasoning summaries, plan progress,
subagent state, media operations, versioned artifacts, typed notices/errors, and the unsupported compatibility
fallback. Generated control and HTTP sources remain Root-owned artifacts and are never hand-maintained here.
Submit keeps renderable `parts` and Asset-owned `attachment_refs` separate. Its generated cross-field constraint
accepts either source while rejecting a truly empty command; any text part that is present remains non-empty.

SSE resume tokens are opaque and travel only in `Last-Event-ID`. Numeric/empty cursors, event/id/cursor mismatches, epoch/order gaps, and sequence reuse under another event identity fail closed; exact cursor/event replays are suppressed. `stream.draining` cannot advance beyond continuously delivered data. Non-success SSE bodies are bounded and decoded through the generated problem schema, preserving stable code/action/retry fields (including contract upgrade). Auth, conflict, contract, and repair outcomes remain distinct.

The initial effect-free SSE attach uses the same bounded full-jitter reconnect policy as later disconnects;
a temporary network failure cannot terminalize a freshly hydrated Chat view. Authentication, contract and
repair failures remain typed and are not retried as transport noise.

Verification: `pnpm --filter @kokoro/session-client lint && pnpm --filter @kokoro/session-client typecheck && pnpm --filter @kokoro/session-client test && pnpm --filter @kokoro/session-client build`.
