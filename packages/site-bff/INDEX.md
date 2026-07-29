# Site BFF

The single server-only composition root for an independently deployed Site. It combines the generated
Platform Public client, `bff-runtime` trust kernel, generated Session Browser v3 route registry, and the
registered node transport provider. It never accepts a Host-derived Site, raw backend URL, browser
credential, or a caller-selected purpose grant.

Auth.js owns the Site-local encrypted cookie and browser authentication ceremony. This package exchanges
credentials with Platform and resolves authoritative actor claims on every runtime bootstrap. Only the
browser-safe bootstrap projection may cross into React props or JSON responses.

One-time credential calls require a caller-supplied secret command that was persisted before dispatch. Generic transport failure
retains that exact identity. A superseding command is legal only after Platform returns typed `delivery_unavailable`, and must carry
the generated prior-command recovery input.

Launch identity/account/Code-redemption composition is also server-only. Ordinary commands live in an AES-GCM sealed,
deployment-bound 8-entry TTL/LRU cookie before the first RPC; secret verification uses the existing recovery-capability
ceremony. Raw Codes are one-hop preview inputs and never enter state, response DTOs, RSC, logs, errors or analytics.
Every Site launch mutation requires fixed-origin/Sec-Fetch proof plus the independent Browser CSRF capability.
Anonymous ordinary commands have no receipt authority: uncertain registration, resend and preview responses
repeat the exact sealed command and payload. Secret one-time commands use capability recovery; authenticated
effects use authenticated receipts, with redemption confirmation using its dedicated idempotency recovery route.
