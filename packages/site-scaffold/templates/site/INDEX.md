# Site project

This repository is the independent Web/deploy boundary for Site `__SITE_KEY_JSON__`. It owns one product package, immutable release, domain bindings, CI artifact and rollback authority.

## Runtime boundary

- Browser code imports only safe types/metadata from `@kokoro/site-client`.
- Credential-bearing Platform/Session calls are server-only through the deployment-registered `@kokoro/site-runtime-node` adapter;
  its Node instrumentation owns validated origins, TLS 1.3 mTLS files, workload credentials, deadlines and streaming. Raw backend URLs
  and runtime Host-to-Site switching remain forbidden outside that package.
- Platform, Session, Agent, accounts, credits and plans remain shared backend authorities selected by the Site/workload binding, not implemented here.

This project contains the complete reusable product composition: Auth.js owns its encrypted `__Host-` HttpOnly cookie and CSRF
ceremony; only opaque Platform session/refresh handles enter the server token; the browser receives neither handles nor identity
authority. The BFF resolves Platform PersonalContext before issuing exact-purpose grants through the generated Session Browser v3
registry. The shared brand-neutral Chat app is rendered only when Platform publishes both the Chat surface and its model catalog.
The shared Account app renders registration, email verification, security sessions, Code redemption, entitlements and credits
only for Platform-enabled Site surfaces. Registration additionally requires server-owned
`KOKORO_SITE_REGISTRATION_LEGAL_DOCUMENTS`; one strict typed SiteRelease projection derives server-only term refs and
browser-safe labels/HTTPS or same-origin links. Browser input can accept the published set but cannot choose authority refs.

When Platform publishes the `image` surface and catalog, this independent Site also renders its own `/studio` creation work area and `/library` artifact browser through `@kokoro/media-app`. Both call only the Site's same-origin allowlisted media BFF. A Studio ready candidate deep-links by opaque Artifact ref; Library validates the ref and resolves it within the authenticated owner list before loading versions. Library emits a content URL only for `ready`; processing, restricted, unavailable, and deleted remain typed owner states. Content authorization is issued and redeemed server-side and streamed without revealing the capability or Platform endpoint.

The Node instrumentation validates the complete local runtime configuration before serving traffic. `/api/health/live` is process-only;
`/api/health/ready` verifies the registered Platform product context and any enabled account/legal configuration without exposing policy. The standalone container runs as a
non-root user, and deployment metadata declares the exact health probes. Root Web has no runnable shared-user fallback.

Chat attachments create owner intent through the same-origin Site BFF, then upload bytes directly to the registered Asset
data plane with an opaque, short-lived capability bound to this Site origin. Provider credentials, object locations and
Platform project selection never cross into browser code. Only a ready trusted grant is submitted to Session.

One-time login, MFA and refresh delivery is fail-safe: a generic upstream timeout retains the exact secret command identity for the
next retry. Only Platform's typed `delivery_unavailable` result permits a new secret command bound to the prior command through the
generated supersede input. Receipt recovery capability never enters client JavaScript, React props, the public Auth.js session, or logs.

## Contract trust

`pnpm artifact:verify` requires `KOKORO_CONTRACT_KEYRING_JSON` from trusted CI/deploy configuration. The keyring is deliberately not committed in this artifact. Expected shape:

```json
{"schemaVersion":1,"keys":[{"keyId":"root-key-id","algorithm":"Ed25519","publicKeySpkiBase64url":"..."}]}
```

## Verification

After the factory creates and commits the initial lockfile, run `pnpm install --frozen-lockfile`, `pnpm audit --prod --audit-level high`,
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm artifact:verify`, and `pnpm build` on Node 24.

Local scaffold/certifier output is Phase A packaging evidence only. It is not Task 18 qualification and does not claim live Platform activation, cross-Site auth/cookie isolation, deployment, rollback, or live Session chat.
