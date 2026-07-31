---
architectureIndex: 1
rootId: web.memory-app
owners: ["@LordFoxFairy"]
---

# Site Memory app

Brand-neutral Product Memory M0.1 controls for independently deployed Sites. The package owns the exact same-origin browser client, Site-scoped ambiguous-command journal, monotonic owner projection and accessible settings/list/detail/history/import/export/purge UI.

It consumes only the generated `platform-public-v1` mirror through `/api/memory`; Site, subject, Project, space and namespace never enter browser state or requests. Saved-memory use, past-chat reference and automatic learning remain visibly independent controls. M0.1 keeps the latter two unavailable and never sends mutation commands for them.

Correction and restore append revisions. Forget/reset expose immediate logical revoke and receipt-backed purge states; a purged revision cannot be restored. Import accepts only authorized quarantined Asset references, and export exposes only Artifact delivery request identity. Content renders as React text, never raw HTML.

The package does not own Memory persistence, Session history, GA context use, Asset/Artifact bytes or Site feature enablement. `@kokoro/site-scaffold` is the build-time authority that either includes the complete package/page/BFF route in one Site artifact or omits them entirely.

Verification: `pnpm --filter @kokoro/memory-app lint && pnpm --filter @kokoro/memory-app typecheck && pnpm --filter @kokoro/memory-app test && pnpm --filter @kokoro/memory-app build`.
