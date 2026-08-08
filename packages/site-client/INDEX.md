---
architectureIndex: 1
rootId: web.site-client
owners:
  - "@LordFoxFairy"
---

# Site client

## Responsibilities

Provides Root-generated Platform Public v1 types/metadata plus a contract-bound, server-only request executor for a Site BFF.

## Public boundary

- `@kokoro/site-client` exports safe generated types, immutable contract metadata, and the generated browser-safe request/reference/response validators used at the Site BFF trust boundary, including the closed explicit-Memory inputs and references consumed by `@kokoro/site-bff`.
- `@kokoro/site-client/server` is guarded by `server-only` and exports the credential-bearing client/transport boundary.
- Media submit accepts the generated canonical caller fingerprint only on `submitMediaOperation`. The typed artifact-delivery client delegates Range/deadline construction to generated code, validates exact owner byte length and 200/206/416 metadata, cancels invalid or unsatisfied upstream streams, and exposes successful bodies as a backpressured counting stream rather than a buffered Blob.
- `@kokoro/site-client/asset-data-plane` is the browser-safe generated upload protocol mirror. It contains no endpoint, Site identity, provider fact, or backend credential.
- Every operation comes from the Root-generated registry. Body/path/query/final contract headers are parsed before transport, only declared success statuses are accepted, and malformed upstream payloads become stable protocol errors without leaking Zod internals. Optional caller `AbortSignal` and bounded relative deadline are explicit transport fields, never generated headers or request body data.
- Effectful operations always receive the generated CSRF header. Command identity is attached only when supplied; the generated
  header schema decides whether it is required, so non-command effects such as Session grant issuance cannot acquire undeclared headers.

## Non-responsibilities

The package never accepts a raw Platform URL and never selects a Site. A registered Site-server transport owns workload/session credential injection and maps the explicit receipt-recovery security field to the outbound request.

## Generated source

`src/generated/contracts/openapi/platform-public/*` and
`src/generated/contracts/openapi/asset-data-plane/*` are the only generated TypeScript clients. Root-owned schemas,
corpora, and metadata live beside them under `src/generated/{schema,contracts}` and the exact generation ledger is
`src/generated/provenance.json`. Per-contract duplicate trees and compatibility re-exports are forbidden.

## Verification

- `pnpm --filter @kokoro/site-client typecheck`
- `pnpm --filter @kokoro/site-client build`

## Callers and dependencies

Reference Site, Asset, Media, Memory, Site BFF, and Node runtime consume this contract package. It has no dependency on another Kokoro workspace package.

## Data ownership and events

Generated metadata and validators mirror Root contracts; the package owns no Platform records, credentials, capabilities, or durable events.

## Runtime and security

Browser imports remain data-only. Credential injection, endpoint selection, response binding, deadlines, and bounded streaming exist only behind the `server-only` transport surface.

## Idempotency, failure, and recovery

Callers supply stable command identity where the generated operation requires it; typed receipt-recovery fields are forwarded only by the registered server transport.

## Extension rules and forbidden dependencies

Change Root contracts and regenerate. Do not hand-edit generated files, add raw URLs, duplicate wire DTOs, or expose the server subpath to browser bundles.

## Current gotchas

The artifact delivery client validates the exact owner size across 200, 206, and 416; a syntactically valid Range response is not sufficient authority.
