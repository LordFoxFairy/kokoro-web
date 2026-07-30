# Kokoro Admin Web

Next.js BFF and Ant Design Pro operations console for authorized Kokoro Sites.

## Runtime boundary

- Operator login is Platform-owned OIDC through typed `AdminIdentityService`; magic-link and email authority are not supported.
- The BFF calls the dedicated Platform Admin listener over HTTP/2 mTLS. Browsers call only same-origin typed `/api/control/*` routes.
- Platform session deliveries are fixed-profile signed-then-encrypted JOSE envelopes. The BFF verifies both layers, exact headers, issuer, audience, workload axes, transaction digest, epochs and attestation before creating its short-lived encrypted HttpOnly session.
- The authority cookie carries the operator's active Site scopes for the configured environment and region. Each BFF request selects one `siteId`; Platform remains the final scope and permission authority.
- Site registration uses an independently granted global scope; SiteRelease publication narrows the command context to the selected Site. The release form submits externally signed certification facts and proof, never a signing private key.
- Card codes exist only in the first `IssueCodeBatch` response and transient component state. They are never cached, logged, placed in Web Storage or recoverably persisted by Web.

Copy `.env.example` to the deployment secret configuration. TLS keys and delivery key rings are loaded lazily from bounded private files; no secret is a build argument.

```bash
pnpm --filter @kokoro/admin-web test
pnpm --filter @kokoro/admin-web lint
pnpm --filter @kokoro/admin-web typecheck
pnpm --filter @kokoro/admin-web build
```

This package owns no Platform database, business transaction, operator authority, offer, redemption program, code inventory or receipt data.
