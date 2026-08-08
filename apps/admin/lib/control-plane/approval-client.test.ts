import { Code } from "@connectrpc/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PendingApprovalOwner } from
  "@/lib/generated/proto/kokoro/platform/admin/v2/admin_query_pb";

const calls = vi.hoisted(() => ({
  query: { listPendingApprovals: vi.fn() },
  requireAuthoritySession: vi.fn(),
}));

vi.mock("@connectrpc/connect", async (importOriginal) => ({
  ...await importOriginal<typeof import("@connectrpc/connect")>(),
  createClient: vi.fn(() => calls.query),
}));
vi.mock("./transport", () => ({ adminControlPlaneTransport: vi.fn(async () => ({})) }));
vi.mock("./authority-session", () => ({ requireAuthoritySession: calls.requireAuthoritySession }));

const instant = { seconds: 1_786_060_800n, nanos: 123_456_000 };
const approvalRef = "00000000-0000-4000-8000-000000000001";
const session = {
  operatorRef: "operator-one", operatorGeneration: "1", operatorSessionRef: "session-one",
  credential: "x".repeat(32), workloadIdentityRef: "spiffe://example/admin", audience: "platform-admin",
  environment: "production", region: "us-east-1", managedDeviceRef: "device-one",
  operatorSecurityEpoch: "1", sessionEpoch: "1", restrictionEpoch: "1", policyEpoch: "1",
  assuranceLevel: "phishing_resistant", factorClasses: ["webauthn"],
  authenticatedAt: "2026-08-06T00:00:00.000Z", stepUpAt: "2026-08-06T00:01:00.000Z",
  operatorAttestationRef: "admin-session:session-one:1", operatorAttestationDigest: "b".repeat(64),
  expiresAt: "2026-08-06T01:00:00.000Z", permissions: ["admin.approval.read"],
  scope: { kind: "site", siteIds: ["site-one"], environment: "production", region: "us-east-1" },
  globalScope: { grantId: "global-one", environment: "production", region: "us-east-1" },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  calls.requireAuthoritySession.mockResolvedValue(session);
});

describe("typed Admin Approval client", () => {
  it.each([
    [PendingApprovalOwner.GENERIC_ADMIN, "generic_admin"],
    [PendingApprovalOwner.SITE_LIFECYCLE, "site_lifecycle"],
  ] as const)("projects generated owner %s into the public composite identity", async (owner, label) => {
    calls.query.listPendingApprovals.mockResolvedValue({ approvals: [{ owner, approvalRef,
      operation: "approval.review", makerRef: "operator-one", targetSiteRef: "site-one",
      environment: "production", region: "us-east-1", operatorReason: "reviewed",
      admittedAt: instant, expiresAt: instant }] });
    const { listPendingApprovals } = await import("./client");

    await expect(listPendingApprovals("site-one")).resolves.toEqual({
      items: [expect.objectContaining({ owner: label, approvalRef })],
      nextPageToken: null,
    });
  });

  it.each([PendingApprovalOwner.UNSPECIFIED, 99])("rejects non-contract owner %s", async (owner) => {
    calls.query.listPendingApprovals.mockResolvedValue({ approvals: [{ owner, approvalRef,
      operation: "approval.review", makerRef: "operator-one", targetSiteRef: "site-one",
      environment: "production", region: "us-east-1", operatorReason: "reviewed",
      admittedAt: instant, expiresAt: instant }] });
    const { listPendingApprovals } = await import("./client");

    await expect(listPendingApprovals("site-one")).rejects.toMatchObject({
      connectCode: Code.Internal,
      domainCode: "admin_control_plane.invalid_response",
    });
  });
});
