---
architectureIndex: 1
rootId: web.chat-surface
owners: ["@LordFoxFairy"]
---

# Chat surface foundation

Owns the browser-safe Kokoro Chat projection and assistant-ui `useExternalStoreRuntime` adapter. Session snapshots and durable events enter one reducer; admitted snapshot actions replace the complete browser projection for Session metadata, branches, active history, command-safe attachment references, and execution state. Same-Session snapshots remain subordinate to private version-plus-fingerprint owner records and an irreversible terminal ledger. A candidate for another Session replaces that scope only after its complete snapshot passes every structural, envelope, and capacity check; an invalid candidate leaves the current Session's authority intact. `ChatProjection` is the only public Chat UI read model; callers must not retain a parallel `SessionSnapshot` for rendering or command construction. Unsupported and incomplete parts, connection state, command conflict, and repair state are first-class and are preserved in adapter extras.

`snapshotRevision` is the opaque cursor of the last successful complete hydrate. It exists to remount viewport-only state after hydrate/repair; it is not the live stream head and must not be compared or incremented by the browser. Session, branch, Run, launch, message, message-part, and owner projections fence their own contract versions or immutable identities. `activeRunProjectionVersion` is the only public Run control precondition; all Run/launch envelope fingerprints remain private to the store. `SessionEvent.projection_version` is aggregate evidence, not a globally monotonic stream revision.

Assistant UI is a rendering/runtime adapter only: it never becomes persistence or terminal-run authority. Commands cross one explicit `ChatCommandPort` call and do not optimistically mutate the projection. Edit/reload/cancel handlers are advertised only when an authoritative port exists.

The Session-owned strict AG-UI mapping seam is present only through the explicit
`@kokoro/chat-surface/agui-presentation-dormant` subpath; the package main entry does not expose it. Its adapter
owns the decoder and accepts only raw `AguiSseFrame` values, so callers cannot bypass admission by constructing a
decoded object. It converts only admitted lifecycle, text,
closed activity, and registered CUSTOM events into a discriminator-correlated `ChatAguiPresentationMutation`; replay produces no
mutation and `stream.draining` remains an explicitly non-durable control mutation. It cannot accept Agent/Python
events, raw/native tool/state/reasoning payloads, or unknown extensions because those are rejected by
`@kokoro/session-client` before mapping. The seam deliberately does not manufacture a `SessionEvent`, parallel
`ChatProjection`, or second assistant-ui store from presentation fields that lack Session owner facts. No current
Chat controller instantiates it; activation waits for the real Session provider, complete compatibility evidence,
and an explicit bridge into the existing `ChatProjection`/assistant-ui external-store authority.
The dormant dispatch port is transactional: every durable mutation carries its opaque cursor as the idempotency
key and must return `applied|replayed`. Decoder cursor/Run/message authority commits only after that acknowledgement.
If a consumer applies a mutation and then loses the acknowledgement, retrying the exact frame dispatches the same
mutation again; the consumer returns `replayed`, after which the decoder commits. Dispatch failure never advances
the resume cursor, and a different frame fails closed while the original admission is pending.

The projection consumes Session browser v3 directly: active history is admitted only when every active-branch message forms the one
exact root-to-leaf parent chain, exhausts that branch's messages, and has contiguous canonical ordinals. A leafless branch is valid
only when its root, leaf, and message set are all empty. Versioned part events replace projections rather than appending transport
deltas and run projections own terminal state. A same-branch leaf change asserted only by Session metadata fails closed until a fresh
snapshot replaces branch authority; a valid `message.created` may extend the exact current lineage. `branch.created` adds only a
version-1 contract branch and keeps the first exact identity; activation of an unseen branch,
Session identity/context drift, or an owner-version gap requests snapshot repair without fabricating branch history. Approval/interaction/plan parts retain their exact owner, version, safe display schema, allowed-action, deadline, and receipt projections so UI commands never reconstruct authority. Reasoning summaries, plan progress, subagents, media operations, artifacts, notices, and errors remain distinct typed parts; there is no generic background-task projection. Tool calls retain their contract-owned call id, result preview, tri-state error marker, and truncation marker while safely defaulting an omitted input summary to an empty object. The assistant-ui adapter preserves the native tool result and error field and emits a typed companion metadata part for fields outside its native shape. Unsupported kinds preserve their message and expose only the generated safe fallback. There is no legacy flat-snapshot or legacy event compatibility path.

Run and launch envelope admission freezes their immutable bindings as well as their canonical fingerprints and one bijective
`runId <-> launchId <-> branchId` pair authority. A complete snapshot rejects an unpaired Run, duplicate pair ownership, and more
than one active execution. Live Run/launch events may arrive in either order, but the first half remains private and cannot project
`launching`/`running`; the pair activates atomically only after both envelopes agree. Consecutive owner versions must follow the
explicit lifecycle transition tables; terminal states can replay exactly but can never revive. Once an authoritative Run is visible,
a matching terminal launch cannot clear it, while a terminal Run always dominates later launch evidence and a conflicting pair
requests repair without committing the rejected envelope. A terminal envelope permanently locks both directions of its
`runId <-> launchId` pair for that Session, including across snapshots that omit the pair; hydrate and live-event admission both
check those locks before replacing or mutating private envelope authority. The ledger has a fixed production capacity of 4096
terminal Run/launch envelopes. Reaching it fails closed with `terminal_authority_capacity_exceeded`; the store never evicts or clears
an earlier safety fact to admit a later one.

A message ID is admitted only from an authoritative Session snapshot or `message.created` event. A new live active-branch message must
be the exact next ordinal, name the current authoritative leaf as parent (or establish the empty branch's first root), and extend the
one current root-to-leaf chain. Admission atomically advances the projected Session/branch leaf; a later same-branch `session.updated`
may confirm Session metadata but cannot certify the still-old branch version. The projection remains
`active_branch_authority_stale`, and all branch-versioned mutations stay disabled until a complete snapshot replaces branch
authority. The store privately fences that live extension to its Session, previous Session version, branch, previous branch version,
and expected leaf. Session and existing Branch owners retain separate immutable-identity and versioned semantic-state fingerprints:
lower versions are rejected and same-version envelopes must replay every owner field exactly. Session identity locks its ID, project,
context policy, and creation instant; `updatedAt` is monotonic while title, lifecycle, active branch, and active leaf may evolve only at
a higher version. Branch identity locks its ID, parent, fork source, origin, and creation instant. Its root is write-once: an empty
branch may establish a root at a higher version, after which no version may change or clear it; leaf state may evolve at a higher
version. Accepted complete live owner events advance the same records. A snapshot clears the fence only when it retains that active
branch, proves the expected complete lineage,
and advances the branch owner version strictly beyond the fence baseline. A complete different active branch may supersede the
fence when its Session version advances beyond that baseline; if a live owner event already established version N, the version-N
snapshot is admitted only when its owner fingerprint is exact. Same/older equivocation remains repair-only. Reset/recovery cannot
erase a same-Session fence, owner record, or terminal Run/launch authority. A snapshot cannot revive a terminal envelope or
its active pair even at a higher owner version, while a complete snapshot for another Session starts with independent authority.
Invalid parent/root/leaf/ordinal
evidence requests repair before the message fingerprint or projection is committed. The
first complete envelope owns that ID; only an exact canonical replay is ignored, while
any same-ID role, branch, lineage, attachment, part, lifecycle, or system-message drift preserves the first projection and requires
repair. A newly observed part starts at version 1; an existing part accepts only its exact replay or the immediately consecutive
version. Same-version equality uses an internal canonical fingerprint of the complete validated envelope before display projection:
JSON object key order is irrelevant, array order remains meaningful, and the fingerprint is never exposed through the public
projection or assistant-ui adapter. Its message, part id, kind, and ordinal are immutable; gaps or identity conflicts preserve the
current projection and require snapshot repair.

Hydration builds private message-envelope, Run-envelope, launch-envelope, message-id, and part-owner indexes and rejects duplicate identities. Streaming part updates use those indexes for constant-time owner/message location while preserving the immutable projection array, exact replay fingerprints, consecutive-version checks, and owner transition validation. Authoritative message creation, branch replacement, and snapshot hydration rebuild the visible indexes; a normal token delta never scans the full message collection or rebuilds them. Unsupported content is rendered only when it arrives as a generated part on an authoritative message; the browser has no mutation that can manufacture a message or part identity.

The exported media operation, candidate, artifact-version, failure, and credit-cost owner unions are the one browser read model shared with Studio and Library. Candidate refs must be unique and arrays must use canonical ordinal order before projection. Platform-owned operation views retain immutable `modelOptionRevisionRef`; Session media parts leave it absent until the Session contract publishes that identity, and transitions can never add, remove, or change it for one owner. Chat adds only Session-owned envelope fields where required; Platform projections never fabricate missing timestamps, operation links, storage URLs, or delivery authority.
