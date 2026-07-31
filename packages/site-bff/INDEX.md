# Site BFF

The single server-only composition root for an independently deployed Site. It combines the generated
Platform Public client, `bff-runtime` trust kernel, generated Session Browser v3 route registry, and the
registered node transport provider. It never accepts a Host-derived Site, raw backend URL, browser
credential, or a caller-selected purpose grant.

Studio and Library use the exact allowlisted media/artifact composition, never a generic Platform proxy. The BFF resolves the Site's current project on the server for definitions, published model options, quote, submit, cancel, recover, operation reads, and artifact/version reads. Generated reference/input validators plus the generated canonical media encoder are the request authority, including UTF-8 and Unicode-scalar boundaries. Every media request starts one monotonic 30-second budget before Site authority resolution and carries the browser AbortSignal plus the remaining deadline through project resolution and the registered Platform transport. Artifact content exists only for an exact ready owner version: the BFF verifies readiness, issues and immediately redeems a one-time capability on the server, validates owner byte size and Range metadata, and streams only the strict safe header allowlist, including a verified owner `bytes */size` 416. Project resolution, owner read, authorization issue, and byte redemption spend that one end-to-end deadline rather than restarting the timeout per hop. Successful bytes are private/no-store, `nosniff`, and same-origin-resource-only. Delivery capability and Platform URL never enter browser JSON, React props, redirects, or content URLs.

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

`site-legal-documents` parses the deployment's single typed legal-document registry. Registration derives
authoritative term references from that registry, while browser props and redemption previews receive only
the exact matched `{ label, href }` projection. Missing, duplicate, or unsafe entries fail closed.
