# Site project

This repository is the independent Web/deploy boundary for Site `__SITE_KEY_JSON__`. It owns one product package, immutable release, domain bindings, CI artifact and rollback authority.

## Runtime boundary

- Browser code imports only safe types/metadata from `@kokoro/site-client`.
- Credential-bearing Platform calls are server-only through `@kokoro/site-client/server` and a deployment-registered transport; raw Platform URLs and runtime Host-to-Site switching are forbidden.
- Platform, Session, Agent, accounts, credits and plans remain shared backend authorities selected by the Site/workload binding, not implemented here.

## Contract trust

`pnpm artifact:verify` requires `KOKORO_CONTRACT_KEYRING_JSON` from trusted CI/deploy configuration. The keyring is deliberately not committed in this artifact. Expected shape:

```json
{"schemaVersion":1,"keys":[{"keyId":"root-key-id","algorithm":"Ed25519","publicKeySpkiBase64url":"..."}]}
```

## Verification

Run `pnpm install --frozen-lockfile`, `pnpm audit --prod --audit-level high`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm artifact:verify`, and `pnpm build` on Node 24.

Local scaffold/certifier output is Phase A packaging evidence only. It is not Task 18 qualification and does not claim live Platform activation, cross-Site auth/cookie isolation, deployment, rollback, or Session chat.
