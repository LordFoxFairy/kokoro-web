import { describe, expect, it } from "vitest";
import { Code } from "@connectrpc/connect";

import { AdminControlPlaneError, commandContext } from "./client";
import type { AdminAuthoritySession } from "./authority-session";

const session: AdminAuthoritySession = {
  operatorRef: "operator-one", operatorGeneration: "1", operatorSessionRef: "session-one",
  credential: "x".repeat(32), workloadIdentityRef: "spiffe://example/admin", audience: "platform-admin",
  environment: "production", region: "us-east-1", managedDeviceRef: "device-one",
  operatorSecurityEpoch: "1", sessionEpoch: "1", restrictionEpoch: "1", policyEpoch: "1",
  assuranceLevel: "phishing_resistant", factorClasses: ["webauthn"],
  authenticatedAt: "2026-07-30T00:00:00.000Z", stepUpAt: "2026-07-30T00:01:00.000Z",
  operatorAttestationRef: "admin-session:session-one:1", operatorAttestationDigest: "a".repeat(64),
  expiresAt: "2026-07-30T01:00:00.000Z", permissions: ["site.register", "site.release.publish"],
  scope: { kind: "site", siteIds: ["site-one", "site-two"], environment: "production", region: "us-east-1" },
  globalScope: { grantId: "global-one", environment: "production", region: "us-east-1" },
};

describe("Admin command authority scope selection", () => {
  it("uses the retained global grant for Site registration", () => {
    const context = commandContext(session, { kind: "global" });
    expect(context.scope?.kind).toEqual({ case: "global", value: expect.objectContaining({ grantId: "global-one" }) });
  });

  it("narrows Site effects to exactly the request-selected Site", () => {
    const context = commandContext(session, { kind: "site", siteId: "site-two" });
    expect(context.scope?.kind).toEqual({ case: "site", value: expect.objectContaining({ siteIds: ["site-two"] }) });
  });

  it("fails before transport when the requested Site is outside delivered authority", () => {
    try {
      commandContext(session, { kind: "site", siteId: "site-other" });
      throw new Error("expected_scope_denial");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminControlPlaneError);
      expect((error as AdminControlPlaneError).connectCode).toBe(Code.PermissionDenied);
      expect((error as AdminControlPlaneError).domainCode).toBe("admin.authority.site_scope_required");
    }
  });
});
