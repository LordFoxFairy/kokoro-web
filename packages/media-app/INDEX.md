---
architectureIndex: 1
rootId: web.media-app
owners: ["@LordFoxFairy"]
---

# Site media app

Brand-neutral Studio and Library product factory for independently deployed Sites. It owns minimal React composition, same-origin browser calls, and command-identity-only reconciliation records; it does not own media operations, artifacts, costs, project selection, or delivery capability.

Studio consumes Site-published definitions and model options, requires a non-binding quote before submit, and uses exact submit/cancel/recover/list/get BFF operations. Library renders Artifact owner list/version/availability and uses BFF content URLs only for exact `ready` versions. Restricted and unavailable retain typed safe failures; processing and deleted never acquire a URL.

Platform responses are exhaustively projected into the owner unions exported by `@kokoro/chat-surface`, so Chat, Studio, and Library render one owner-state read model without a parallel Generation/Job abstraction. Each generated Site injects its own brand name, runtime scope, CSRF, and theme while retaining an independent Web project, artifact, deployment, and domain.

Verification: `pnpm --filter @kokoro/media-app lint && pnpm --filter @kokoro/media-app typecheck && pnpm --filter @kokoro/media-app test && pnpm --filter @kokoro/media-app build`.
