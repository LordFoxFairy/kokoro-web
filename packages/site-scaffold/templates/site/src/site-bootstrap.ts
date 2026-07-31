import { defineSiteAppManifest } from "@kokoro/site-app-kit";

export const site = defineSiteAppManifest({
  enabledProductIds: __ENABLED_PRODUCT_IDS_JSON__,
  packageName: __PACKAGE_NAME_JSON__,
  siteKey: __SITE_KEY_JSON__,
  displayName: __DISPLAY_NAME_JSON__,
  domains: __DOMAINS_JSON__,
  release: {
    releaseId: __RELEASE_ID_JSON__,
    artifactSha256: __ARTIFACT_SHA256_JSON__,
    profileRevision: __PROFILE_REVISION_JSON__,
  },
  contractFloor: __CONTRACT_FLOOR_JSON__,
});
