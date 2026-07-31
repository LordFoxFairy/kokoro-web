import { defineSiteAppManifest } from "@kokoro/site-app-kit";
import { PLATFORM_PUBLIC_CONTRACT_METADATA } from "@kokoro/site-client";

/** Contract/E2E fixture only. Production Sites are generated into independent repositories. */
export const referenceSite = defineSiteAppManifest({
  enabledProductIds: [],
  packageName: "@kokoro/reference-site",
  siteKey: "reference-site",
  displayName: "Reference AI Workspace",
  domains: [{ hostname: "reference.invalid", environment: "preview" }],
  release: {
    releaseId: "reference.wave1.0001",
    artifactSha256: "10467d2914bb2dde5a4dc0714e617879b92f77e2e7168da56c76cbfda493d62e",
    profileRevision: "reference-profile.v1",
  },
  contractFloor: {
    contract: "platform-public-v1",
    version: "1",
    schemaSha256: PLATFORM_PUBLIC_CONTRACT_METADATA.sourceDigestSha256,
    signature: "reference-fixture-not-for-production",
    signingKeyId: "reference-fixture",
  },
});
