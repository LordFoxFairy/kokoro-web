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

## Runtime and security

- Any existing target, including an empty directory or symlink, is rejected.
- Each tgz must match the caller-provided SHA-256 and its internal `package/package.json` name/version; copied bytes are hashed again before publication to close source-path TOCTOU.
- Generated config, scripts, routes/imports and environment access are scanned for Host switching, raw Platform/DB coupling, backend imports and shared-account/session semantics.
- Contract-floor verification requires a keyring injected by trusted CI/deploy authority; an artifact cannot declare its own key trusted.
- Host switching is a deployment-edge responsibility because standalone routes see only the internal listener URL.
  Generated app code does not read or trust forwarded Host headers; auth writes require the exact configured browser
  `Origin` and same-origin fetch marker after the runtime configuration gate succeeds. Auth.js `trustHost` is enabled
  only under this strict ingress and exact `AUTH_URL`/`KOKORO_SITE_PUBLIC_ORIGIN` deployment contract.

## Current gotchas

`scripts/certify-external-sites.mjs` proves only local Phase A packaging/isolation/build mechanics. Its ephemeral self-signed key is a test fixture and is not Task 18, live Platform, live auth, deploy or rollback qualification.
The generated project is now a complete app composition: Auth.js password/TOTP ceremony, opaque credential rotation,
Platform-owned bootstrap, exact generated Session Browser v3 proxy, shared capability-scoped Asset upload client, shared Chat product, and Site-local Studio/Library routes from the brand-neutral media factory. Platform catalog publication remains
the fail-closed source of enabled surfaces. Live activation, auth journey, cookie isolation, deploy and rollback evidence are still required.

Optional product composition is physical and fail-closed. A release with `enabledProductIds: ["memory"]` carries the Memory tgz,
dependency, page, Site-shell navigation, bootstrap declaration and exact same-origin BFF route; a release without it carries none
of those bytes or operations. Even an included page/BFF remains unavailable unless the resolved Platform bootstrap also enables
the `memory` surface. `scripts/certify-external-sites.mjs` builds one enabled and one disabled independent artifact and records each
exact package closure.

`allowedLaunchOperations` is an optional release-compiled closed set. Its default is the complete generic Site launch set, so
ordinary scaffold callers retain registration and verification. A profile that removes public identity acquisition physically
omits the corresponding pages and registration navigation while the generated launch composition passes the same allowlist to
`createSiteLaunchApi`; a direct request therefore cannot recover a physically removed feature through the shared account route.

## Verification

- `pnpm --filter @kokoro/site-scaffold typecheck`
- `pnpm --filter @kokoro/site-scaffold build`

## Non-responsibilities

The scaffold does not host production Sites, activate releases, own runtime Site policy, trust artifact-supplied keys, or qualify live authentication, deploy, and rollback.

## Public boundary

`@kokoro/site-scaffold` exposes the project generator from the built `dist/scaffold.js` package export.

## Callers and dependencies

Root tooling and Site delivery CI call the generator. The package depends only on `@kokoro/site-app-kit` among Kokoro workspace packages.

## Data ownership and events

The generator owns candidate project files and build evidence. Platform owns SiteRelease and activation facts; each generated repository owns its artifact and deployment history.

## Idempotency, failure, and recovery

Generation rejects every pre-existing target and publishes only after complete validation. A failed attempt leaves no accepted target; recovery uses a new empty destination.

## Extension rules and forbidden dependencies

Add reusable Site composition through pinned package closure and qualification checks. Do not add shared production hosting, Host switching, embedded trust roots, direct sibling source imports, or runtime-only optional branches.
