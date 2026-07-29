---
architectureIndex: 1
rootId: web.user.server
owners:
  - "@LordFoxFairy"
---

# User Site server boundary

Each deployed Web project represents one immutable Site. `src/auth.ts` owns email/password and MFA
ceremonies through Auth.js Credentials, while `site-bff.ts` composes the generated Platform Public client
and registered HTTPS/mTLS transports. Browser code receives neither credentials, backend origins, workload
authority, nor receipt recovery capabilities.

Login, MFA, and refresh are two-request ceremonies: a Site-local encrypted cookie persists the exact
one-time command before the first RPC. A lost-response supersede creates a new command/idempotency pair
but atomically reuses the prior raw recovery capability and consumes the prior command. Success clears the
delivery cookie. The encrypted Auth.js cookie contains the Platform session and refresh pair.

`session-v3.ts` adapts that opaque Platform session to `SiteBffRuntime.assemble()`. Product context,
personal context, Session access grants, and browser proxying remain server-owned. `launch-api.ts` owns the
separate registration, email verification, account, and Code-redemption ceremony.

`http-boundary.ts` supplies bounded browser-body readers. `site-bff.ts` and `session-v3.ts` accept only the
provider installed by instrumentation; requests cannot select internal targets or credentials.
