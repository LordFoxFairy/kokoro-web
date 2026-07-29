# Site project

This repository is the independent Web/deploy boundary for Site `__SITE_KEY_JSON__`. It owns one product package, immutable release, domain bindings, CI artifact and rollback authority.

## Runtime boundary

- Browser code imports only safe types/metadata from `@kokoro/site-client`.
- Credential-bearing Platform/Session calls are server-only through the deployment-registered `@kokoro/site-runtime-node` adapter;
  its Node instrumentation owns validated origins, TLS 1.3 mTLS files, workload credentials, deadlines and streaming. Raw backend URLs
  and runtime Host-to-Site switching remain forbidden outside that package.
- Platform, Session, Agent, accounts, credits and plans remain shared backend authorities selected by the Site/workload binding, not implemented here.

This scaffold revision installs the reusable production transport and immutable package closure only. It does not yet generate the
Session/Platform BFF routes, sealed Auth session bridge, or Chat product UI, so it must not be described as a complete runnable product
composition until the Site Factory app-composition slice adds those consumers.

## Contract trust

`pnpm artifact:verify` requires `KOKORO_CONTRACT_KEYRING_JSON` from trusted CI/deploy configuration. The keyring is deliberately not committed in this artifact. Expected shape:

```json
{"schemaVersion":1,"keys":[{"keyId":"root-key-id","algorithm":"Ed25519","publicKeySpkiBase64url":"..."}]}
```

## Verification

Run `pnpm install --frozen-lockfile`, `pnpm audit --prod --audit-level high`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm artifact:verify`, and `pnpm build` on Node 24.

Local scaffold/certifier output is Phase A packaging evidence only. It is not Task 18 qualification and does not claim live Platform activation, cross-Site auth/cookie isolation, deployment, rollback, or Session chat.
