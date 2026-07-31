---
architectureIndex: 1
rootId: web.media-app
owners: ["@LordFoxFairy"]
---

# Site media app

Brand-neutral Studio and Library product factory for independently deployed Sites. It owns minimal React composition, same-origin browser calls, and command-identity-only reconciliation records; it does not own media operations, artifacts, costs, project selection, or delivery capability.

Studio consumes Site-published definitions and model options, hard-validates the active input against the published candidate/aspect/format/prompt bounds, requires a non-binding quote before submit, and uses exact submit/cancel/recover/list/get BFF operations. Library renders Artifact owner list/version/availability and uses BFF content URLs only for exact `ready` versions. Restricted and unavailable retain typed safe failures; processing and deleted never acquire a URL.

Every BFF success payload is parsed with the generated Platform Public runtime schema and correlated to the requested definition, revision, command, operation, artifact, or version before it can enter React state. Publication changes reconcile the entire Studio draft atomically and invalidate old quotes. Command recovery is Site-scope local, canonical-ISO, bounded to 20 entries and a 24-hour TTL; denied browser storage fails closed with a recoverable UI error.

Platform responses are exhaustively projected into the owner unions exported by `@kokoro/chat-surface`, so Chat, Studio, and Library render one owner-state read model without a parallel Generation/Job abstraction. Each generated Site injects its own brand name, browser runtime scope, CSRF, and theme while retaining an independent Web project, artifact, deployment, and domain. Studio and Library atomically hide/reset prior-scope state; every bootstrap, action, selection, recovery, and polling request is abortable and generation-fenced so an abort-insensitive stale completion cannot mutate the next account/project scope.

Verification: `pnpm --filter @kokoro/media-app lint && pnpm --filter @kokoro/media-app typecheck && pnpm --filter @kokoro/media-app test && pnpm --filter @kokoro/media-app build`.
