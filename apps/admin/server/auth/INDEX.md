# Admin Authentication Boundary

This directory owns the Node-only Auth.js integration. `adapter.ts` exposes the complete fourteen
method IAM-backed database Adapter; `cookie.ts` is the single session-cookie name/options and token
reader. `session-boundary.ts` implements the testable policy; `session.ts` binds it to Auth.js and
Next cookies, fails closed on non-admin identities, and exchanges the opaque cookie for one ephemeral
actor transport. `redirect.ts` is the explicit relative control-route allowlist.
`options.ts` composes the fixed Auth.js database-session policy; `email.ts` owns real SMTP delivery.
`route.ts` enforces the configured host and same-origin POST before Auth.js handles the request.

Client Components never import this directory or receive opaque Session tokens, IAM access tokens,
workload credentials, or provider tokens.
