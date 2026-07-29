---
architectureIndex: 11
rootId: service.web.account-app
owners: ["@LordFoxFairy"]
---

# @kokoro/account-app

Brand-neutral browser UI for Site registration, email verification, security sessions, Code redemption,
entitlements and credits. It calls only fixed same-origin Site BFF routes and never receives Platform/Site
authority, opaque credentials, recovery capabilities, preview credentials, Code inventory or internal refs.

Verification links carry the public transaction reference in the query/path and the one-time secret only in
the URL fragment. The client clears that fragment before dispatching the same-origin BFF request. Redemption
renders the safe preview and requires explicit acceptance whenever Platform returns authoritative term refs.
Registration requires a 15-character password, confirmation, and browser-safe legal labels/links from
`KOKORO_SITE_REGISTRATION_LEGAL_DOCUMENTS`; the shared strict parser derives authoritative server-only term refs
and browser-safe labels/links from that one SiteRelease projection. Redemption maps sealed preview refs through the same registry.
