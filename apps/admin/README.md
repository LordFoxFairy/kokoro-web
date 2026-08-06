# Kokoro Admin Web

Next.js security BFF with Refine, Ant Design 5, and stable Pro Components for authorized Kokoro operators.

## Runtime boundary

- Operator login is Platform-owned OIDC through typed `AdminIdentityService`; magic-link and email authority are not supported.
- The BFF calls the dedicated Platform Admin listener over HTTP/2 mTLS. Browsers call only same-origin typed `/api/control/*` routes.
- Platform session deliveries are fixed-profile signed-then-encrypted JOSE envelopes. The BFF verifies both layers, exact headers, issuer, audience, workload axes, transaction digest, epochs and attestation before creating its short-lived encrypted HttpOnly session.
- The authority cookie carries the operator's active Site scopes for the configured environment and region. Each BFF request selects one `siteId`; Platform remains the final scope and permission authority.
- Credit is read only through generated AdminCredit routes. Generic manifest/resource/action/OpenAPI routes, billing overview aggregation, and User360 fan-out are physically absent. The User page uses the typed one-User-within-Site AdminQuery read.
- Credit/User navigation and requests derive from the Platform-aligned surface matrix: `credit.summary.read`, `credit.account.read`, `credit.grant.read`, `credit.hold.read`, `credit.journal.read`, `credit.rated-usage.read`, and `admin.user.read`. The BFF enforces the same matrix from the verified authority session before RPC; the browser cannot grant itself a surface.
- Site registration uses an independently granted global scope; SiteRelease publication narrows the command context to the selected Site. The release form submits externally signed certification facts and proof, never a signing private key.
- Unimplemented Commerce and card-code screens are absent. They return only with typed maker/checker, one-time delivery acknowledgement, and authoritative receipt recovery.
- Refine is a browser resource/query framework only. Its provider is a closed exact-resource registry; it never receives a Platform URL, credential, database connection, or generic mutation authority.

Copy `.env.example` to the deployment secret configuration. TLS keys and delivery key rings are loaded lazily from bounded private files; no secret is a build argument.

```bash
pnpm --filter @kokoro/admin-web test
pnpm --filter @kokoro/admin-web lint
pnpm --filter @kokoro/admin-web typecheck
pnpm --filter @kokoro/admin-web build
```

This package owns no Platform database, business transaction, operator authority, offer, redemption program, code inventory or receipt data.
