# Chat App

Brand-neutral, client-only Chat product composition shared by every generated Site project and the reference fixture.
It owns browser Session transport, Chat orchestration, command reconciliation, session organization,
and the runnable React surface. It never receives Platform credentials, workload credentials,
deployment bindings, or backend URLs; those remain in the same-origin Site BFF.

Branding, published model catalogs, enabled surfaces, projects, and browser CSRF are injected via
the browser-safe `PublicSiteBootstrap` projection. A Site that does not publish Chat does not render it.

Standard-Session composer drafts are isolated by browser runtime scope and Session. The browser persists only
bounded text, product-level model/effort refs, and an opaque local revision in tab-scoped storage; attachment
grants and command payloads remain memory-only. A Temporary Chat never uses composer, command, or upload
recovery storage and never appears in the ordinary history/search rail. Its uploader uses a per-mounted-Session
ephemeral recovery store that is discarded when the Session or browser runtime scope changes.
An active Run keeps the next-turn draft editable but cannot submit or become `run.steer`. A reconciled submit
clears only the exact local revision bound to its receipt, never text entered while that receipt was pending.

The controller publishes no raw `SessionSnapshot`. Hydration replaces `ChatProjection`, and live `session.updated` / `branch.created`
events update that same browser authority. Title, context policy, branch selector, viewport remount revision, edit/regenerate source metadata,
and attachment command references are all read from the projection; `ChatProduct` and `ChatView` never maintain a second stale UI model.

The product supports model/effort selection, Markdown/GFM output, human approval and plan controls,
message edit/regenerate, and explicit branch fork/activation. Every mutation uses the generated Browser
command-digest preimage, a stable command identity, exact receipt reconciliation after an ambiguous
transport outcome, and a fresh authoritative snapshot before the UI returns to idle.

Durable output is rendered by kind: reasoning summaries, plan progress, subagent state, media operations,
versioned artifacts, notices, and errors have separate product views. Media operations display their
capability, contract status, basis-point progress, safe metadata, and final artifact reference; they are not
treated as agent orchestration. Artifact views display their exact artifact/version references and content type.
Unknown generated kinds remain visible through the unsupported safe fallback instead of dropping the message.
Tool cards distinguish an authoritative tool-result error from transport lifecycle state and disclose when the
safe result preview was truncated.

The conversation viewport initially mounts a bounded tail window and preserves stable message identities while
older pages are revealed. Prepending history restores the reader's exact scroll anchor. Streaming follows only
while the reader is near the end; once detached it keeps the viewed content stationary, coalesces updates into
one accessible “jump to latest” notice, and never steals scroll. Site/runtime scope, active branch, and fresh
snapshot identity remount this UI-only viewport state without changing Session authority. Off-screen message
layout uses browser content visibility as a second paint/layout guard. Code downloads are created only from the
already safe-rendered text in a temporary browser Blob URL that is revoked immediately; this is unrelated to
Artifact delivery capabilities. On narrow screens the session organizer is an aria-expanded disclosure and
moves focus into its first enabled action when opened.

Transport reconnect is effect-free and resumes the opaque Session cursor with bounded jitter. Any cursor,
branch, message identity, part-version, or authorization projection repair closes the stale stream and single-flights a fresh
complete snapshot before attaching again. A hydrate that still requires repair never enters ready/live or opens an event stream;
submit, edit, regenerate, branch, cancel, approval, and plan commands share one fail-closed projection-authority guard, and their
UI controls stay disabled until an explicit or automatic fresh-snapshot repair succeeds. A failed repair remains an explicit
user-retryable state; the UI never displays internal recovery action tokens or treats a browser reconnect as a new Run.
Mutation authority additionally requires a live stream, an idle projected command, and a non-disposed controller. The controller
synchronously claims its single browser command slot before command-digest work begins, so double submit/create/HITL gestures cannot
race through an async preimage calculation. `close()` is terminal: it aborts snapshot work, closes the stream, and no later callback,
open, create, or mutation can revive that controller. Snapshot repair marks the projection unavailable before its request begins;
an invalid or missing repair result clears all Session/UI authority instead of publishing stale content.
Model and effort selection may update the next-turn draft while a mutation's authoritative post-effect snapshot is pending, but it
cannot release or overwrite that pending command slot. A valid selection clears a prior selection failure only when no command or
snapshot request owns the slot. Invalid selector input may publish local validation only from an otherwise healthy idle controller;
it cannot replace a snapshot/repair/reconciliation failure or turn an invalid→valid selector sequence into mutation authority.
Run and launch versions/fingerprints are fenced monotonically inside the projection store; a regression, conflicting replay, or gap
forces snapshot repair instead of regressing visible terminal state. Cancel and HITL commands read only the active Run version
published by `ChatProjection`, so the controller cannot retain a parallel execution authority. HITL callers provide only
`{runId, partId, decision}`; immediately before dispatch the controller re-resolves the current pending part, allowed actions,
deadline, owner identity, owner version, and `inputSchemaRef` from that projection. `edit`/`respond` decisions are rejected when the
caller's schema ref differs, and the dispatched request is rebuilt with the projection-owned ref. A previously rendered part object
is never command authority.

Before a Chat mutation crosses the BFF, its non-secret receipt lookup identity is bounded and stored in the
current browser session. An ambiguous response can therefore only query the exact command/digest after a
refresh; it never creates a replacement command or stores prompt/effect input in browser recovery state.

Product wording is supplied through a typed copy dictionary. Chat attachments use the shared Asset client:
the Site BFF derives owner scope, the browser streams bytes only under a short-lived exact-origin capability,
and Session receives only ready `{asset_ref, asset_version_ref, asset_grant_ref}` values. Upload credentials
remain memory-only; refresh recovery reselects the same fingerprint and replays persisted idempotency identities.
The composer admits text, ready attachments, or both, but never neither. Attachment-only Submit sends an empty
`parts` array plus ready `attachment_refs`; it never manufactures an empty text part. Pending and failed uploads
remain non-submittable.
Both command recovery and upload recovery are scoped by a server-derived opaque browser runtime scope that rotates with the Site
identity session. A scope change aborts active uploads, closes Session/SSE controllers, prunes prior recovery records, and remounts
the composer so ready attachment grants cannot cross an account switch.

`standard|temporary` is an explicit create intent and an immutable Session-owner fact, not an in-place UI
toggle. The controller requires the create receipt and hydrated snapshot to echo the requested policy before
exposing the Session. A directly authorized Temporary Chat can still hydrate and reconnect by its exact URL,
but the product only promises exclusion from ordinary history; the persistent badge states that Site
retention, safety, and legal-hold rules still apply. Saved Memory and Admission suppression remain backend
owner responsibilities and are not inferred or advertised by this package.
