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

- `defineSiteAppManifest` validates package/Site/release/domain/contract-floor identity plus the closed, duplicate-free
  `enabledProductIds` release set and returns an immutable manifest.
- Release IDs are opaque Platform Site lifecycle references and use the owner authority's
  `[A-Za-z0-9][A-Za-z0-9._:-]{2,127}` contract; they are not Web-owned slugs.
- `verifySiteContractFloor` compares the exact Platform Public contract floor, resolves the signing key from an injected trusted keyring, and delegates cryptography to an injected verification port.
- `SiteWebSessionBridge` accepts only an already sealed server-created envelope; it never exposes Platform credentials to browser code.

## Non-responsibilities

This package owns types and pure admission logic. `enabledProductIds` describes physical product composition in one signed Site
artifact; it does not replace Platform's runtime surface authority. The package does not resolve Host headers, select a Site at
runtime, contact Platform, store accounts, implement cookies, or ship a trust root inside the artifact being verified.

## Extension rules and forbidden dependencies

Keep the package framework- and runtime-neutral. New trust algorithms belong behind `SiteContractFloorVerificationPort`; deployment/CI authority must inject trusted key material.

## Verification

- `pnpm --filter @kokoro/site-app-kit typecheck`
- `pnpm --filter @kokoro/site-app-kit build`

## Callers and dependencies

`@kokoro/site-scaffold` and the reference fixture consume this pure package. It has no dependency on another Kokoro workspace package.

## Data ownership and events

The package owns immutable manifest and contract-floor value types only. Platform owns SiteRelease and product authority; deployment tooling owns artifact publication.

## Runtime and security

Admission is pure and environment-neutral. Trusted key material and cryptographic verification are injected by deployment authority and never embedded as self-trust.

## Idempotency, failure, and recovery

Manifest definition and contract-floor verification are deterministic and effect-free; invalid identity, product sets, signatures, or floors fail before publication.

## Current gotchas

`enabledProductIds` controls physical artifact composition and does not replace Platform runtime surface admission.
