---
architectureIndex: 1
rootId: web.site-app-kit
owners:
  - "@LordFoxFairy"
---

# Site app kit

## Responsibilities

Defines the brand-neutral, immutable Site manifest and the environment-neutral contract-floor trust protocol used by independently deployed Site projects.

## Public boundary

- `defineSiteAppManifest` validates package/Site/release/domain/contract-floor identity and returns an immutable manifest.
- `verifySiteContractFloor` compares the exact Platform Public contract floor, resolves the signing key from an injected trusted keyring, and delegates cryptography to an injected verification port.
- `SiteWebSessionBridge` accepts only an already sealed server-created envelope; it never exposes Platform credentials to browser code.

## Ownership and exclusions

This package owns types and pure admission logic. It does not resolve Host headers, select a Site at runtime, contact Platform, store accounts, implement cookies, or ship a trust root inside the artifact being verified.

## Extension rules

Keep the package framework- and runtime-neutral. New trust algorithms belong behind `SiteContractFloorVerificationPort`; deployment/CI authority must inject trusted key material.

## Verification

- `pnpm --filter @kokoro/site-app-kit typecheck`
- `pnpm --filter @kokoro/site-app-kit build`
