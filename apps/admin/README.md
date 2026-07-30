# Kokoro Admin Web

Next.js BFF and Ant Design Pro operations console for one configured Kokoro Site.

## Runtime boundary

- Operator login is Platform-owned OIDC through typed `AdminIdentityService`; magic-link and email authority are not supported.
- The BFF calls the dedicated Platform Admin listener over HTTP/2 mTLS. Browsers call only same-origin typed `/api/control/*` routes.
- Platform session deliveries are fixed-profile signed-then-encrypted JOSE envelopes. The BFF verifies both layers, exact headers, issuer, audience, workload axes, transaction digest, epochs and attestation before creating its short-lived encrypted HttpOnly session.
- The deployment-fixed `KOKORO_ADMIN_SITE_ID` is injected server-side. Browser `siteId` claims cannot steer Commerce queries or commands.
- Card codes exist only in the first `IssueCodeBatch` response and transient component state. They are never cached, logged, placed in Web Storage or recoverably persisted by Web.

Copy `.env.example` to the deployment secret configuration. TLS keys and delivery key rings are loaded lazily from bounded private files; no secret is a build argument.

```bash
pnpm --filter @kokoro/admin-web test
pnpm --filter @kokoro/admin-web lint
pnpm --filter @kokoro/admin-web typecheck
pnpm --filter @kokoro/admin-web build
```

This package owns no Platform database, business transaction, operator authority, offer, redemption program, code inventory or receipt data.
