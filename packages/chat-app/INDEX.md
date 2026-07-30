# Chat App

Brand-neutral, client-only Chat product composition shared by every generated Site project and the reference fixture.
It owns browser Session transport, Chat orchestration, command reconciliation, session organization,
and the runnable React surface. It never receives Platform credentials, workload credentials,
deployment bindings, or backend URLs; those remain in the same-origin Site BFF.

Branding, published model catalogs, enabled surfaces, projects, and browser CSRF are injected via
the browser-safe `PublicSiteBootstrap` projection. A Site that does not publish Chat does not render it.

Composer drafts are isolated by browser runtime scope and Session. The browser persists only bounded text,
product-level model/effort refs, and an opaque local revision in tab-scoped storage; attachment grants and
command payloads remain memory-only.
An active Run keeps the next-turn draft editable but cannot submit or become `run.steer`. A reconciled submit
clears only the exact local revision bound to its receipt, never text entered while that receipt was pending.

The product supports model/effort selection, Markdown/GFM output, human approval and plan controls,
message edit/regenerate, and explicit branch fork/activation. Every mutation uses the generated Browser
command-digest preimage, a stable command identity, exact receipt reconciliation after an ambiguous
transport outcome, and a fresh authoritative snapshot before the UI returns to idle.

Transport reconnect is effect-free and resumes the opaque Session cursor with bounded jitter. Any cursor,
branch, part-version, or authorization projection repair closes the stale stream and single-flights a fresh
complete snapshot before attaching again. A failed repair remains an explicit user-retryable state; the UI
never displays internal recovery action tokens or treats a browser reconnect as a new Run.
Run and launch projection versions are also fenced monotonically; a regression, conflicting replay, or gap
forces snapshot repair instead of regressing visible terminal state or issuing control with a stale version.

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
