---
architectureIndex: 1
rootId: web.chat-surface
owners: ["@LordFoxFairy"]
---

# Chat surface foundation

Owns the browser-safe Kokoro Chat projection and assistant-ui `useExternalStoreRuntime` adapter. Session snapshots and durable events enter one reducer; snapshot actions replace history. Unsupported and incomplete parts, connection state, command conflict, and repair state are first-class and are preserved in adapter extras.

Assistant UI is a rendering/runtime adapter only: it never becomes persistence or terminal-run authority. Commands cross one explicit `ChatCommandPort` call and do not optimistically mutate the projection. Edit/reload/cancel handlers are advertised only when an authoritative port exists.

The projection consumes Session browser v3 directly: active history is reconstructed from the snapshot leaf/parent lineage, versioned part events replace projections rather than appending transport deltas, run projections own terminal state, and branch activation fails closed until a fresh snapshot arrives. Approval/interaction/plan parts retain their exact owner, version, safe display schema, allowed-action, deadline, and receipt projections so UI commands never reconstruct authority. There is no legacy flat-snapshot or legacy event compatibility path.
