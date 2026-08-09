import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandReceiptStateV2 } from
  "@/lib/generated/proto/kokoro/common/v2/command_envelope_pb";
import {
  CodeBatchApprovalState,
  CodeBatchRecoveryAction,
  CodeBatchState,
} from "@/lib/generated/proto/kokoro/platform/commerce/v1/commerce_control_pb";
import {
  CommerceCommandDisposition,
  CreditProgramBucketClass,
  CreditProgramRolloverPolicy,
  CreditProgramWindowKind,
} from "@/lib/generated/proto/kokoro/platform/commerce/v1/commerce_catalog_pb";

const calls = vi.hoisted(() => ({
  commerce: {
    listCreditProgramRevisions: vi.fn(),
    getCreditProgramRevision: vi.fn(),
    issueCodeBatch: vi.fn(),
    approveCodeBatch: vi.fn(),
  },
  requireAuthoritySession: vi.fn(),
}));

vi.mock("@connectrpc/connect", async (importOriginal) => ({
  ...await importOriginal<typeof import("@connectrpc/connect")>(),
  createClient: vi.fn(() => calls.commerce),
}));
vi.mock("./transport", () => ({ adminControlPlaneTransport: vi.fn(async () => ({})) }));
vi.mock("./authority-session", () => ({ requireAuthoritySession: calls.requireAuthoritySession }));

const instant = { seconds: 1_774_915_200n, nanos: 0 };
const session = {
  operatorRef: "operator:maker", operatorGeneration: "1", operatorSessionRef: "session-one",
  credential: "x".repeat(32), workloadIdentityRef: "spiffe://example/admin", audience: "platform-admin",
  environment: "production", region: "us-east-1", managedDeviceRef: "device-one",
  operatorSecurityEpoch: "1", sessionEpoch: "1", restrictionEpoch: "1", policyEpoch: "1",
  assuranceLevel: "phishing_resistant", factorClasses: ["webauthn"],
  authenticatedAt: "2026-07-30T00:00:00.000Z", stepUpAt: "2026-07-30T00:01:00.000Z",
  operatorAttestationRef: "admin-session:session-one:1", operatorAttestationDigest: "b".repeat(64),
  expiresAt: "2026-07-30T01:00:00.000Z", permissions: ["commerce.*"],
  scope: { kind: "site", siteIds: ["site-one"], environment: "production", region: "us-east-1" },
  globalScope: { grantId: "global-one", environment: "production", region: "us-east-1" },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  calls.requireAuthoritySession.mockResolvedValue(session);
});

describe("server-only AdminCommerce Connect client", () => {
  it("passes an HMAC cursor through as a completely opaque token under the exact Site context", async () => {
    const pageToken = `eyJhbGciOiJIUzI1NiJ9.${"x".repeat(1_900)}`;
    calls.commerce.listCreditProgramRevisions.mockResolvedValue({
      items: [{
        siteId: "site-one", creditProgramRevisionRef: "credit:one:v1", programRef: "credit:one",
        revision: 1n, uxBucketClass: CreditProgramBucketClass.PERMANENT, unit: "credit", amount: "100",
        burnPriority: 10, scopePolicy: { policyVersion: 1, surfaceRefs: ["chat"],
          capabilityKeys: ["model.chat"], agentRefs: [], allowUnattributedAgent: true },
        liabilityMerchantAccountRef: "merchant:one", windowKind: CreditProgramWindowKind.NONE,
        rolloverPolicy: CreditProgramRolloverPolicy.NONE, revisionDigest: "a".repeat(64), publishedAt: instant,
      }],
      nextPageToken: "opaque-next", observedAt: instant,
    });
    const { adminCommerceClient } = await import("./commerce-client");

    await expect(adminCommerceClient.listCreditPrograms({ siteId: "site-one", pageToken })).resolves.toMatchObject({
      items: [{ siteId: "site-one", id: "credit:one:v1", revision: "1", bucketClass: "permanent" }],
      nextPageToken: "opaque-next",
      observedAt: "2026-03-31T00:00:00.000Z",
    });
    const [request, options] = calls.commerce.listCreditProgramRevisions.mock.calls[0]!;
    expect(request).toMatchObject({ context: { siteId: "site-one" }, page: { pageSize: 100, pageToken } });
    expect(options).toMatchObject({ headers: expect.any(Headers) });
  });

  it("rejects a detail projection that is not bound to the requested Site and resource", async () => {
    calls.commerce.getCreditProgramRevision.mockResolvedValue({ revision: {
      siteId: "site-other", creditProgramRevisionRef: "credit:other:v1",
    } });
    const { adminCommerceClient } = await import("./commerce-client");

    await expect(adminCommerceClient.getCreditProgram("site-one", "credit:one:v1"))
      .rejects.toMatchObject({ connectCode: Code.Internal, domainCode: "admin_commerce.invalid_response" });
  });

  it("returns fresh raw codes once and does not retry an ambiguous Issue call", async () => {
    calls.commerce.issueCodeBatch.mockImplementationOnce(async (request: unknown) => {
      const context = (request as { context: { operator?: { command?: unknown } } }).context;
      return {
        receipt: { state: CommandReceiptStateV2.COMMITTED, identity: context.operator?.command,
          operation: "commerce.code-batch.issue", recordedAt: instant },
        disposition: CommerceCommandDisposition.COMMITTED,
        result: { batchRef: "00000000-0000-4000-8000-000000000001", codeCount: 1,
          redemptionProgramRevisionRef: "redeem:one:v1", createdByOperatorRef: "operator:maker",
          exportedAt: instant },
        delivery: { case: "secretExport", value: {
          rawCodes: ["KC1-01234567-0123456789-0123456789ABCDEFGHJKMNPQRSTVWXYZ01-01234567"],
        } },
      };
    });
    const { adminCommerceClient } = await import("./commerce-client");

    const result = await adminCommerceClient.issueCodeBatch({ siteId: "site-one",
      batchRef: "00000000-0000-4000-8000-000000000001",
      redemptionProgramRevisionRef: "redeem:one:v1", count: 1 });
    expect(result.delivery).toEqual({ kind: "secret_export", rawCodes: [expect.stringMatching(/^KC1-/u)] });
    expect(calls.commerce.issueCodeBatch).toHaveBeenCalledOnce();

    calls.commerce.issueCodeBatch.mockRejectedValueOnce(new ConnectError("unknown", Code.Unavailable));
    await expect(adminCommerceClient.issueCodeBatch({ siteId: "site-one",
      batchRef: "00000000-0000-4000-8000-000000000002",
      redemptionProgramRevisionRef: "redeem:one:v1", count: 1 })).rejects.toMatchObject({ connectCode: Code.Unavailable });
    expect(calls.commerce.issueCodeBatch).toHaveBeenCalledTimes(2);
  });

  it("maps replay to the required abandon-and-reissue guidance without raw codes", async () => {
    calls.commerce.issueCodeBatch.mockImplementationOnce(async (request: unknown) => {
      const context = (request as { context: { operator?: { command?: unknown } } }).context;
      return {
        receipt: { state: CommandReceiptStateV2.COMMITTED, identity: context.operator?.command,
          operation: "commerce.code-batch.issue", recordedAt: instant },
        disposition: CommerceCommandDisposition.REPLAYED,
        result: { batchRef: "00000000-0000-4000-8000-000000000001", codeCount: 1,
          redemptionProgramRevisionRef: "redeem:one:v1", createdByOperatorRef: "operator:maker",
          exportedAt: instant },
        delivery: { case: "deliveryUnavailable", value: {
          requiredAction: CodeBatchRecoveryAction.ABANDON_AND_REISSUE,
        } },
      };
    });
    const { adminCommerceClient } = await import("./commerce-client");

    await expect(adminCommerceClient.issueCodeBatch({ siteId: "site-one",
      batchRef: "00000000-0000-4000-8000-000000000001",
      redemptionProgramRevisionRef: "redeem:one:v1", count: 1 })).resolves.toMatchObject({
      disposition: "replayed",
      delivery: { kind: "delivery_unavailable", requiredAction: "abandon_and_reissue" },
    });
  });

  it("requires a different checker through the server permission surface and validates the owner result", async () => {
    calls.commerce.approveCodeBatch.mockImplementationOnce(async (request: unknown) => {
      const context = (request as { context: { operator?: { command?: unknown } } }).context;
      return { receipt: { state: CommandReceiptStateV2.COMMITTED, identity: context.operator?.command,
        operation: "commerce.code-batch.approve", recordedAt: instant },
      disposition: CommerceCommandDisposition.COMMITTED,
      result: { batchRef: "00000000-0000-4000-8000-000000000001", state: CodeBatchState.DRAFT,
        approvalState: CodeBatchApprovalState.APPROVED, changedAt: instant } };
    });
    const { adminCommerceClient } = await import("./commerce-client");

    await expect(adminCommerceClient.approveCodeBatch("site-one",
      "00000000-0000-4000-8000-000000000001")).resolves.toMatchObject({
      state: "draft", approvalState: "approved",
    });
    expect(calls.requireAuthoritySession).toHaveBeenCalledOnce();
  });
});
