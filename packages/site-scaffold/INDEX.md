---
architectureIndex: 1
rootId: web.site-scaffold
owners:
  - "@LordFoxFairy"
---

# Site scaffold

## Responsibilities

Creates one product-named, independently versioned/deployed project per Site from the immutable `site-app-kit`, generated clients,
brandless BFF kernel, and Node deployment-adapter package closure.

## Supply-chain boundary

- Any existing target, including an empty directory or symlink, is rejected.
- Each tgz must match the caller-provided SHA-256 and its internal `package/package.json` name/version; copied bytes are hashed again before publication to close source-path TOCTOU.
- Generated config, scripts, routes/imports and environment access are scanned for Host switching, raw Platform/DB coupling, backend imports and shared-account/session semantics.
- Contract-floor verification requires a keyring injected by trusted CI/deploy authority; an artifact cannot declare its own key trusted.

## Qualification boundary

`scripts/certify-external-sites.mjs` proves only local Phase A packaging/isolation/build mechanics. Its ephemeral self-signed key is a test fixture and is not Task 18, live Platform, live auth, deploy or rollback qualification.
The generated project is now a complete app composition: Auth.js password/TOTP ceremony, opaque credential rotation,
Platform-owned bootstrap, exact generated Session Browser v3 proxy, and the shared Chat product. Platform catalog publication remains
the fail-closed source of enabled surfaces. Live activation, auth journey, cookie isolation, deploy and rollback evidence are still required.

## Verification

- `pnpm --filter @kokoro/site-scaffold typecheck`
- `pnpm --filter @kokoro/site-scaffold build`
