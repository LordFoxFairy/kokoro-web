---
architectureIndex: 1
rootId: web.chat-surface
owners: ["@LordFoxFairy"]
---

# Chat surface

Owns the one browser-safe Chat read model and the assistant-ui `useExternalStoreRuntime` adapter.

## Authority model

Chat has exactly two inputs with different jobs:

- A complete Session HTTP snapshot hydrates the baseline: Session metadata, branches, active message history, command-safe attachment references, execution state, and `snapshot_revision_ref`.
- The Session-owned strict AG-UI stream is the only live content path. It updates presentation lifecycle, assistant text, closed activities, and registered CUSTOM owner replacements.

`ChatProjectionStore` exposes no generic event mutation and no second live reducer. Connection, command, and repair mutations are local control state only; they cannot manufacture durable content. A new snapshot replaces or repairs the complete baseline. The AG-UI adapter transactionally acknowledges each durable cursor as `applied|replayed`; decoder authority advances only after that acknowledgement.

`snapshotRevision` is the opaque `snapshot_revision_ref` of the last successful hydrate. It is neither an SSE cursor nor a stream sequence and the browser never parses, compares, or increments it. The decoder alone owns the opaque resume cursor.

Session command identity and presentation identity are deliberately separate:

- `activeRunId` and `activeRunProjectionVersion` are Session command preconditions used by cancel/HITL.
- `presentationRunId` and `presentationRunState` are browser presentation identities from AG-UI.

An AG-UI Run can therefore never overwrite the Run ID used for a Session command.

## Closed presentation profile

The production `@kokoro/chat-surface/agui-presentation` adapter accepts raw `AguiSseFrame` values and owns the strict decoder. Callers cannot bypass admission with a decoded object. It maps only:

- official Run lifecycle and assistant text events;
- Kokoro safe-summary, tool-preview, HITL, plan, subagent, media, artifact, cost, notice, and error activities;
- registered Session, branch, message, Run, control, and receipt CUSTOM replacements;
- non-durable `kokoro.stream.draining` control.

Unknown events, raw/native tool payloads, provider state, reasoning/thinking, secrets, internal route references, extra fields, binding conflicts, cursor gaps, and lifecycle conflicts fail before projection. Recoverable cursor/scope conflicts request a fresh snapshot; malformed contract data fails closed as incompatible.

Every durable mutation carries its opaque cursor as the idempotency key. If projection commits but acknowledgement is uncertain, retrying the exact frame returns `replayed` without applying it twice. A different payload under the same cursor marks the projection for repair.

## UI model

`ChatProjection` is the only public render and command read model. Product code does not retain a parallel Session snapshot or assistant-ui message store. The external-store adapter projects the same immutable state into assistant-ui:

- text remains native text;
- tool preview becomes a native tool-call plus typed metadata;
- all other activities remain discriminator-correlated typed data parts;
- unsupported or unsafe content is never reconstructed in the browser.

The Chat product renders deterministic cards for tool, activity, artifact, media, cost, notice, error, and HITL state. Stop is exposed only when an authoritative Session command Run ID exists, even if an AG-UI presentation Run is visibly streaming.

## Snapshot safety

Snapshot hydration validates active branch existence, exact active root-to-leaf message lineage, canonical ordinals, duplicate identities, immutable owner bindings, Run/launch pairing, terminal authority, and bounded projection indexes. Invalid snapshots request repair without fabricating history. Same-Session owner/version regressions preserve the newer committed projection; a valid different-Session snapshot starts a new authority scope.

The separate `@kokoro/chat-surface/agui-compatibility-consumer` subpath remains release-evidence infrastructure, not a product Controller. It feeds provider fixtures through the same public adapter and compares final committed Web authority with the independently validated Session final snapshot.

Verification: `pnpm --filter @kokoro/chat-surface lint && pnpm --filter @kokoro/chat-surface typecheck && pnpm --filter @kokoro/chat-surface test && pnpm --filter @kokoro/chat-surface build`.
