---
architectureIndex: 1
rootId: web.chat-surface
owners: ["@LordFoxFairy"]
---

# Chat surface foundation

Owns the browser-safe Kokoro Chat projection and assistant-ui `useExternalStoreRuntime` adapter. Session snapshots and durable events enter one reducer; snapshot actions replace history. Unsupported and incomplete parts, connection state, command conflict, and repair state are first-class and are preserved in adapter extras.

Assistant UI is a rendering/runtime adapter only: it never becomes persistence or terminal-run authority. Commands cross one explicit `ChatCommandPort` call and do not optimistically mutate the projection. Edit/reload/cancel handlers are advertised only when an authoritative port exists.

The projection consumes Session browser v3 directly: active history is reconstructed from the snapshot leaf/parent lineage, versioned part events replace projections rather than appending transport deltas, run projections own terminal state, and branch activation fails closed until a fresh snapshot arrives. Approval/interaction/plan parts retain their exact owner, version, safe display schema, allowed-action, deadline, and receipt projections so UI commands never reconstruct authority. Reasoning summaries, plan progress, subagents, media operations, artifacts, notices, and errors remain distinct typed parts; there is no generic background-task projection. Tool calls retain their contract-owned call id, result preview, tri-state error marker, and truncation marker while safely defaulting an omitted input summary to an empty object. The assistant-ui adapter preserves the native tool result and error field and emits a typed companion metadata part for fields outside its native shape. Unsupported kinds preserve their message and expose only the generated safe fallback. There is no legacy flat-snapshot or legacy event compatibility path.

A newly observed part starts at version 1; an existing part accepts only its exact replay or the immediately consecutive version. Same-version equality uses an internal canonical fingerprint of the complete validated envelope before display projection: JSON object key order is irrelevant, array order remains meaningful, and the fingerprint is never exposed through the public projection or assistant-ui adapter. Its message, part id, kind, and ordinal are immutable; gaps or identity conflicts preserve the current projection and require snapshot repair.

Hydration builds private message-id and part-owner indexes and rejects duplicate identities. Streaming part updates use those indexes for constant-time owner/message location while preserving the immutable projection array, exact replay fingerprints, consecutive-version checks, and owner transition validation. Message creation, branch replacement, snapshot hydration, and unsupported-part insertion rebuild the indexes; a normal token delta never scans the full message collection or rebuilds them.

The exported media operation, candidate, artifact-version, failure, and credit-cost owner unions are the one browser read model shared with Studio and Library. Candidate refs must be unique and arrays must use canonical ordinal order before projection. Platform-owned operation views retain immutable `modelOptionRevisionRef`; Session media parts leave it absent until the Session contract publishes that identity, and transitions can never add, remove, or change it for one owner. Chat adds only Session-owned envelope fields where required; Platform projections never fabricate missing timestamps, operation links, storage URLs, or delivery authority.
