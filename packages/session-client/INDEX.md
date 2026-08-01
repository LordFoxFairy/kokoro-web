---
architectureIndex: 1
rootId: web.session-client
owners: ["@LordFoxFairy"]
---

# Session client

Brand-neutral client over Root-generated Session HTTP/SSE schemas. Callers inject a path-only transport; this package accepts no raw Session URL, Site identity, namespace, bearer token, or credential resolver.

The Root-generated Session browser v3 mirror is live. The client exposes the complete browser command surface, including typed action/plan decisions and receipt reconciliation, validates the full projection snapshot, and hydrates only from its opaque snapshot watermark.
Session creation requires an explicit immutable `standard|temporary` `context_policy`; both the create receipt
and every owner snapshot carry the policy. The client does not infer a default or offer an update operation.
The generated HTTP mirror carries the full durable part union, including reasoning summaries, plan progress,
subagent state, media operations, versioned artifacts, typed notices/errors, and the unsupported compatibility
fallback. Generated control and HTTP sources remain Root-owned artifacts and are never hand-maintained here.
Submit keeps renderable `parts` and Asset-owned `attachment_refs` separate. Its generated cross-field constraint
accepts either source while rejecting a truly empty command; any text part that is present remains non-empty.

SSE resume tokens are opaque and travel only in `Last-Event-ID`. Numeric/empty cursors, event/id/cursor mismatches, epoch/order gaps, and sequence reuse under another event identity fail closed; exact cursor/event replays are suppressed. `stream.draining` cannot advance beyond continuously delivered data. Non-success SSE bodies are bounded and decoded through the generated problem schema, preserving stable code/action/retry fields (including contract upgrade). Auth, conflict, contract, and repair outcomes remain distinct.

The initial effect-free SSE attach uses the same bounded full-jitter reconnect policy as later disconnects;
a temporary network failure cannot terminalize a freshly hydrated Chat view. Authentication, contract and
repair failures remain typed and are not retried as transport noise.
Snapshot fetch and hydration accept an optional `AbortSignal` and forward the exact signal to the injected
transport. Product controllers use it to cancel superseded, unmounted, and closed authority requests; cancellation
does not create a second Session endpoint or a transport-specific escape hatch.

The strict AG-UI presentation consumer is present but **dormant**. `@ag-ui/core@0.0.57` is pinned exactly and
`EventSchemas` is used only after Kokoro's smaller closed profile has passed UTF-8 byte, JSON depth/node/key/array,
event, source-mapping, grant, cursor, Session, epoch, sequence, timestamp, binding, thread, message-END, and terminal
checks. RAW, native tool, state/delta, reasoning/thinking, unknown activity/custom, extra fields, provider payload,
and secret-bearing previews fail closed. The decoder preserves SSE `id`/`event`, emits the exact opaque cursor as
both `Last-Event-ID` and the matching query cursor, and never treats `stream.draining` as durable progress. Its
identity/run/message authority ledgers are bounded at 4096 facts and fail closed to future HTTP snapshot repair
instead of evicting irreversible facts.

Session remains the only browser presentation owner. The Python `ag-ui-protocol` package and Agent raw events are
not participants, and `@ag-ui/client`, `useAgUiRuntime`, and stock AG-UI transports are forbidden because they do
not preserve Kokoro cursor/snapshot/repair authority. No active Web controller opens the AG-UI stream until a real
Session provider and cross-repository compatibility evidence are promoted.

Verification: `pnpm --filter @kokoro/session-client lint && pnpm --filter @kokoro/session-client typecheck && pnpm --filter @kokoro/session-client test && pnpm --filter @kokoro/session-client build`.
