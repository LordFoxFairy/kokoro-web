---
architectureIndex: 1
rootId: web.site-bff
owners:
  - "@LordFoxFairy"
---

# Site BFF

The single server-only composition root for an independently deployed Site. It combines the generated
Platform Public client, `bff-runtime` trust kernel, generated Session Browser v3 route registry, and the
registered node transport provider. It never accepts a Host-derived Site, raw backend URL, browser
credential, or a caller-selected purpose grant.

Studio and Library use the exact allowlisted media/artifact composition, never a generic Platform proxy. The BFF resolves the Site's current project on the server for definitions, published model options, quote, submit, cancel, recover, operation reads, and artifact/version reads. Generated reference/input validators plus the generated canonical media encoder are the request authority, including UTF-8 and Unicode-scalar boundaries. Every media request starts one monotonic 30-second budget before auth-session resolution and carries the browser AbortSignal plus the remaining deadline through the auth read, ProductContext exchange, PersonalContext project resolution, and registered Platform transport. Artifact content exists only for an exact ready owner version: the BFF verifies readiness, issues and immediately redeems a one-time capability on the server, validates owner byte size and Range metadata, and streams only the strict safe header allowlist, including a verified owner `bytes */size` 416. Project resolution, owner read, authorization issue, and byte redemption spend that one end-to-end deadline rather than restarting the timeout per hop. Successful bytes are private/no-store, `nosniff`, and same-origin-resource-only. Delivery capability and Platform URL never enter browser JSON, React props, redirects, or content URLs.

Saved Memory uses `createSiteMemoryApi`, an exact same-origin façade over the generated Memory operation set. It rejects unknown methods/paths and duplicate/unknown query keys before resolving owner authority, requires Origin plus the browser CSRF capability for every mutation, caps request JSON at 64 KiB with fatal UTF-8 decoding, and spends one monotonic 30-second budget across auth, ProductContext/PersonalContext resolution and Platform transport. Site, subject, Project, space and namespace are server-derived and never accepted from browser path/query/body. Mutation transport/protocol ambiguity returns only the original command id and its same-origin recovery route; response JSON is capped at 2 MiB. This façade does not expose past-chat search, automatic learning, Temporary Chat, MemorySelection or ContextUse.

Auth.js owns the Site-local encrypted cookie and browser authentication ceremony. This package exchanges
credentials with Platform and resolves authoritative actor claims on every runtime bootstrap. Only the
browser-safe bootstrap projection may cross into React props or JSON responses.

The deployment edge owns exact Host resolution before traffic reaches the standalone listener. Site BFF routes do not
reconstruct the public origin from the internal request URL or trust forwarded Host headers. Reads require the browser's
same-origin fetch signal; mutations additionally require the configured public `Origin` and the independent browser CSRF
capability. Every locally generated Session failure uses the generated bounded envelope with the exact
`application/problem+json` media type, including stream retry responses.

One-time credential calls require a caller-supplied secret command that was persisted before dispatch. Generic transport failure
retains that exact identity. A superseding command is legal only after Platform returns typed `delivery_unavailable`, and must carry
the generated prior-command recovery input.

Launch identity/account/Code-redemption composition is also server-only. Ordinary commands live in an AES-GCM sealed,
deployment-bound 8-entry TTL/LRU cookie before the first RPC; secret verification uses the existing recovery-capability
ceremony. Raw Codes are one-hop preview inputs and never enter state, response DTOs, RSC, logs, errors or analytics.
Every Site launch mutation requires fixed-origin/Sec-Fetch proof plus the independent Browser CSRF capability.
`createSiteLaunchApi` may receive a release-compiled closed operation allowlist. It validates that list once and rejects a
parsed but disabled operation before capability resolution or any Platform transport. Omitting the list preserves the complete
generic Site operation set; Platform-published surfaces remain the second runtime gate for operations that the artifact includes.
Anonymous ordinary commands have no receipt authority: uncertain registration, resend and preview responses
repeat the exact sealed command and payload. Secret one-time state reads use the recovery capability without also
sending a Bearer session; a missing exact recovery row preserves the sealed command for same-idempotency retry.
`disableTotp` and `revokeIdentitySessions` use their generated same-identity/receipt-body retry contract and never
call the public state-read receipt. Redemption confirmation keeps its dedicated idempotency recovery route.

`site-legal-documents` parses the deployment's single typed legal-document registry. Registration derives
authoritative term references from that registry, while browser props and redemption previews receive only
the exact matched `{ label, href }` projection. Missing, duplicate, or unsafe entries fail closed.

## Responsibilities

Compose one independent Site's server-only authentication, Platform Public, Session Browser, Media, Artifact, Memory, account, and Code-redemption boundaries.

## Non-responsibilities

This package does not select a Site from Host, expose a generic Platform proxy, own Platform or Session data, render browser products, or store provider and capability secrets in client state.

## Public boundary

`@kokoro/site-bff` exposes the server composition root; `@kokoro/site-bff/site-legal-documents` exposes the strict legal-document registry parser.

## Callers and dependencies

Generated Site projects instantiate this package. It depends on `@kokoro/bff-runtime`, `@kokoro/session-client`, `@kokoro/site-client`, and `@kokoro/site-runtime-node`.

## Data ownership and events

Platform owns Site, identity, commercial, Media, Artifact, and receipt facts; Session owns conversation and presentation facts. The BFF owns only Site-local cookies and bounded sealed recovery state.

## Runtime and security

Exact deployment binding, same-origin proof, CSRF, generated validation, one monotonic deadline, and server-only transport credentials guard every route.

## Idempotency, failure, and recovery

Ordinary, secret, and authenticated effects retain their appropriate command or capability identity and reconcile through the typed owner recovery route after ambiguity.

## Extension rules and forbidden dependencies

Expose only an exact product facade backed by generated contracts. Do not add generic proxying, Host-derived routing, raw backend URLs, sibling source imports, or browser-visible authority.

## Current gotchas

Raw Codes and one-time secrets must remain one-hop inputs; sealed command state may carry only bounded non-secret recovery identity.

## Verification

Run `pnpm --filter @kokoro/site-bff lint`, `pnpm --filter @kokoro/site-bff typecheck`, `pnpm --filter @kokoro/site-bff test`, and `pnpm --filter @kokoro/site-bff build`.
