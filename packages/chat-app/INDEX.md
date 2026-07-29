# Chat App

Brand-neutral, client-only Chat product composition shared by every generated Site project and the reference fixture.
It owns browser Session transport, Chat orchestration, command reconciliation, session organization,
and the runnable React surface. It never receives Platform credentials, workload credentials,
deployment bindings, or backend URLs; those remain in the same-origin Site BFF.

Branding, published model catalogs, enabled surfaces, projects, and browser CSRF are injected via
the browser-safe `PublicSiteBootstrap` projection. A Site that does not publish Chat does not render it.

The product supports model/effort selection, Markdown/GFM output, human approval and plan controls,
message edit/regenerate, and explicit branch fork/activation. Every mutation uses the generated Browser
command-digest preimage, a stable command identity, exact receipt reconciliation after an ambiguous
transport outcome, and a fresh authoritative snapshot before the UI returns to idle.

Transport reconnect is effect-free and resumes the opaque Session cursor with bounded jitter. Any cursor,
branch, part-version, or authorization projection repair closes the stale stream and single-flights a fresh
complete snapshot before attaching again. A failed repair remains an explicit user-retryable state; the UI
never displays internal recovery action tokens or treats a browser reconnect as a new Run.

Product wording is supplied through a typed copy dictionary. Asset attachment controls remain absent
until the Asset owner exposes its grant-backed intake contract; Chat never invents upload authority.
