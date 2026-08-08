# Kokoro Admin Web

Next.js security BFF with Refine, Ant Design 5, and stable Pro Components for authorized Kokoro operators.

## Runtime boundary

- Operator login is Platform-owned OIDC through typed `AdminIdentityService`; magic-link and email authority are not supported.
- Anonymous `/login` and `/auth/verify` renders make no current-operator or Site-catalog request; switching into
  either route invalidates an older catalog generation without changing the Platform OIDC flow.
- The BFF calls the dedicated Platform Admin listener over HTTP/2 mTLS. Browsers call only same-origin typed `/api/control/*` routes.
- Platform session deliveries are fixed-profile signed-then-encrypted JOSE envelopes. The BFF verifies both layers, exact headers, issuer, audience, workload axes, transaction digest, epochs and attestation before creating its short-lived encrypted HttpOnly session.
- The authority cookie carries the operator's active Site scopes for the configured environment and region. Each BFF request selects one `siteId`; Platform remains the final scope and permission authority.
- Credit is read only through generated AdminCredit routes. Generic manifest/resource/action/OpenAPI routes, billing overview aggregation, and User360 fan-out are physically absent. The User page uses the typed one-User-within-Site AdminQuery read.
- Credit/User navigation and requests derive from the Platform-aligned surface matrix: `credit.summary.read`, `credit.account.read`, `credit.grant.read`, `credit.hold.read`, `credit.journal.read`, `credit.rated-usage.read`, and `admin.user.read`. The BFF enforces the same matrix from the verified authority session before RPC; the browser cannot grant itself a surface.
- Site registration uses an independently granted global scope; SiteRelease publication narrows the command context to the selected Site. The release form submits externally signed certification facts and proof, never a signing private key.
- Unimplemented Commerce and card-code screens are absent. They return only with typed maker/checker, one-time delivery acknowledgement, and authoritative receipt recovery.
- Refine is a browser resource/query framework only. Its provider is a closed exact-resource registry; it never receives a Platform URL, credential, database connection, or generic mutation authority.
- Operators, Sites, pending Approvals, and scoped Audit are registered Refine resources. Their exact BFF schemas,
  optional Site filter, identity mapping, and opaque cursor traversal live once in the provider; resource pages do
  not issue parallel list requests. Site detail is the only registered resource detail read.
- Cursor lists use Refine `useInfiniteList` with a fixed 100-row BFF page and explicit load-more controls. The
  provider returns `cursor.next`, accepts the canonical 1024-character token, rejects offset/page-size requests,
  disables numeric fallback on terminal pages, and normalizes BFF failures to Refine `HttpError`. Its shared
  cumulative window fails closed on cursor cycles, repeated page params, duplicate IDs, more than 20 pages, more
  than 1000 records, or continuation at either limit. The App shell
  reuses the same exact Operator/Site schemas for its authority header and bounded Site selector. The overview
  reads the same validated Approvals resource and
  shows a lower bound when a continuation exists rather than claiming an unavailable global total.

Copy `.env.example` to the deployment secret configuration. TLS keys and delivery key rings are loaded lazily from bounded private files; no secret is a build argument.

## Production artifact

Admin is an independent Next standalone OCI workload. It never shares the reference Site artifact.
Build it only from the Web repository root, then promote its registry digest rather than a mutable tag:

```bash
pnpm run build:admin
pnpm run build:admin:image
```

The Web-owned [`deployables.yaml`](../../deployables.yaml) authorizes `admin-web` and keeps the
unselected independent Site release blocked. `/api/health/live` is process-only;
`/api/health/ready` loads the complete private configuration and requires a bounded mTLS HTTP/2
settings exchange with Platform Admin. Both responses are no-store and readiness failures disclose
only a stable unavailable state. See [`deploy/README.md`](deploy/README.md) for immutable promotion,
the read-only container security context, and rollback.

```bash
pnpm --filter @kokoro/admin-web test
pnpm --filter @kokoro/admin-web lint
pnpm --filter @kokoro/admin-web typecheck
pnpm --filter @kokoro/admin-web build
```

This package owns no Platform database, business transaction, operator authority, offer, redemption program, code inventory or receipt data.
