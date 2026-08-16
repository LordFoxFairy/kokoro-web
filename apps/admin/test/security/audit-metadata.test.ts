import { describe, expect, it } from "vitest";

import { projectAuditMetadata } from "../../modules/iam/audit/query";

describe("SecurityEvent metadata projection", () => {
  it("WEB-SEC-METADATA-001 exposes only validated allowlisted metadata", () => {
    const projected = projectAuditMetadata(JSON.stringify({
      slug: "kokoro-labs",
      name: "Kokoro Labs",
      roleKey: "owner",
      revoked: true,
      revokedCount: 3,
      reason: "operator-authored and intentionally hidden",
      ignored: "not part of the projection",
    }));

    expect(projected).toEqual({
      slug: "kokoro-labs",
      name: "Kokoro Labs",
      roleKey: "owner",
      revoked: true,
      revokedCount: 3,
    });
    expect(Object.isFrozen(projected)).toBe(true);
  });

  it("WEB-SEC-METADATA-001 hides malformed oversized and secret-bearing metadata as a whole", () => {
    expect(projectAuditMetadata("{" )).toBeNull();
    expect(projectAuditMetadata(JSON.stringify({ name: "x".repeat(4_097) }))).toBeNull();
    expect(projectAuditMetadata(JSON.stringify({ roleKey: "owner", accessToken: "TOKEN" }))).toBeNull();
    expect(projectAuditMetadata(JSON.stringify({ roleKey: "owner", nested: { password: "PASSWORD" } }))).toBeNull();
    expect(projectAuditMetadata(JSON.stringify({ name: "Bearer TOKEN" }))).toBeNull();
  });
});
