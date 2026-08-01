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

The strict AG-UI presentation consumer is present only through the explicit
`@kokoro/session-client/agui-presentation-dormant` subpath; the package main entry does not expose it.
`@ag-ui/core@0.0.57` is pinned exactly and
`EventSchemas` is used only after Kokoro's smaller closed profile has passed UTF-8 byte, JSON depth/node/key/array,
event, source-mapping, grant, cursor, Session, epoch, sequence, timestamp, binding, thread, message-END, and terminal
checks. RAW, native tool, state/delta, reasoning/thinking, unknown activity/custom, extra fields, provider payload,
and secret-bearing previews fail closed. The decoder preserves SSE `id`/`event`, emits the exact opaque cursor as
both `Last-Event-ID` and the matching query cursor, and never treats `stream.draining` as durable progress. Its
cursor/source identity ledger is fixed at 4096 facts, Run authority at 256, and message authority at 512; callers
may lower but cannot raise those production ceilings. All ledgers fail closed to future HTTP snapshot repair
instead of evicting irreversible facts. JSON structure admission uses an iterative, early-stopping traversal, so a
deep but byte-bounded input cannot exhaust the JavaScript call stack before the depth gate runs.
Raw SSE admission first requires an exact plain `{id,event,data}` object with primitive fields and counts their
UTF-8 bytes with an allocation-bounded scan before parsing `data`; circular extras, accessors, BigInt, class
instances, and oversized payloads therefore produce stable protocol errors instead of native serialization errors.
The decoder also exposes a transactional `prepare`/`commit` seam. A prepared durable frame owns one pending slot,
does not advance cursor or lifecycle authority before commit, permits only an exact retry, and rejects a different
frame until the pending mutation receives an explicit `applied|replayed` acknowledgement. There is no public
auto-commit decoder path. CUSTOM Run/message replacements have bounded owner ledgers with canonical closed-payload
fingerprints, immutable bindings, consecutive versions, irreversible lifecycle transitions, and native
RUN/TEXT-terminal interlocks; all owner and cursor changes commit atomically only after the external acknowledgement.

Replay admission retains only compact cursor/source identity strings, the last committed raw frame, and at most one
pending raw frame. The exported byte budgets are ceilings for retained UTF-8 identity/wire payload, not an estimate
of JavaScript heap usage; `Set`/`Map`/string object overhead remains runtime-dependent but cardinality is separately
bounded. An exact retry of the last committed cursor is reported as replayed. Any older cursor, including a
byte-identical frame, fails closed as `agui_stream_identity_duplicate`; Session resume semantics request events
*after* the committed `Last-Event-ID`, while older recovery requires the future authoritative snapshot-repair path.

Session remains the only browser transport and presentation owner: Web never connects to Agent or trusts an Agent
raw payload. Agent/Python may become the internal AG-UI producer only after Root pins the Python SDK and TypeScript
SDK to one reviewed upstream revision and proves the Agent-to-Session mapping through cross-repository compatibility
evidence. `@ag-ui/client`, `useAgUiRuntime`, and stock browser transports remain forbidden because they do not
preserve Kokoro cursor/snapshot/repair authority. R0 also has no browser snapshot-authority schema capable of
seeding thread, Run, message, cursor, and source ledgers. Consequently decoder construction fails closed with
`agui_snapshot_authority_required` for every nonzero initial durable sequence. No active Web controller opens the
AG-UI stream until both provider compatibility and snapshot repair authority are promoted.

Verification: `pnpm --filter @kokoro/session-client lint && pnpm --filter @kokoro/session-client typecheck && pnpm --filter @kokoro/session-client test && pnpm --filter @kokoro/session-client build`.
