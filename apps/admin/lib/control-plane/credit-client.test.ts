import { describe, expect, it, vi } from "vitest";

import {
  CreditBucketClass,
  CreditGrantSourceType,
  CreditReadFreshness,
} from "@/lib/generated/admin-credit/kokoro/platform/credit/v1/admin_credit_pb";
import { createAdminCreditReader } from "./credit-client";

const at = (seconds: bigint) => ({ seconds, nanos: 0 });
const watermark = at(1_785_369_600n);
const wrongSite = "site-two";

function identityOnly(values: Readonly<Record<string, unknown>>): never {
  return new Proxy(values, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`mapped_before_identity_validation:${String(key)}`);
    },
  }) as never;
}

const invalidResponse = { name: "AdminCreditInvalidResponseError", domainCode: "admin_credit.invalid_response" };

describe("typed Admin Credit client", () => {
  it("maps authority summary and uint64 facts to browser-safe decimal strings", async () => {
    const getSiteCreditSummary = vi.fn(async () => ({ summary: {
      siteId: "site-one", creditAccountCount: 9_007_199_254_740_993n, activeCreditAccountCount: 2n,
      openHoldCount: 3n, reconciliationRequiredHoldCount: 1n,
      balances: [{ unit: "credit", availableAmount: "100", reservedAmount: "20", consumedAmount: "30",
        expiredAmount: "0", revokedAmount: "0", recoveryExposureAmount: "1" }],
      freshness: CreditReadFreshness.AUTHORITATIVE_DATABASE_OBSERVATION, asOf: watermark,
      providerPayload: { forbidden: true },
    } }));
    const runtime = vi.fn(async () => ({ rpc: { getSiteCreditSummary }, context: { requestId: "request-one" },
      headers: new Headers({ authorization: "Bearer sealed" }) }));
    const reader = createAdminCreditReader(runtime as never);

    await expect(reader.getSiteCreditSummary("site-one")).resolves.toEqual({
      siteId: "site-one", creditAccountCount: "9007199254740993", activeCreditAccountCount: "2",
      openHoldCount: "3", reconciliationRequiredHoldCount: "1",
      balances: [{ unit: "credit", availableAmount: "100", reservedAmount: "20", consumedAmount: "30",
        expiredAmount: "0", revokedAmount: "0", recoveryExposureAmount: "1" }],
      freshness: "database_observation", asOf: "2026-07-30T00:00:00.000Z",
    });
    expect(runtime).toHaveBeenCalledWith("site-one");
    expect(getSiteCreditSummary).toHaveBeenCalledWith(
      { context: { requestId: "request-one" }, siteId: "site-one" },
      { headers: expect.any(Headers) },
    );
  });

  it("sends a complete source identity and preserves pagination observation facts", async () => {
    const listCreditGrants = vi.fn(async () => ({ grants: [{
      siteId: "site-one", creditGrantId: "33333333-3333-4333-8333-333333333333",
      creditAccountRef: "11111111-1111-4111-8111-111111111111", billingAccountRef: "billing:one",
      creditProgramRevisionRef: "program:v1", sourceType: CreditGrantSourceType.REDEMPTION,
      sourceRef: "redeem:one", issuanceJournalTransactionRef: "22222222-2222-4222-8222-222222222222",
      uxBucketClass: CreditBucketClass.PERMANENT, unit: "credit", originalAmount: "100", burnPriority: 1,
      effectiveAt: watermark, expiresAt: undefined, issuedAt: watermark,
      relatedHoldCount: 1n, relatedExecutionCount: 2n,
    }], nextPageToken: "next", membershipWatermark: watermark, observedAt: at(1_785_369_601n) }));
    const reader = createAdminCreditReader(vi.fn(async () => ({ rpc: { listCreditGrants }, context: {},
      headers: new Headers() })) as never);

    const response = await reader.listCreditGrants({ siteId: "site-one",
      sourceType: "redemption", sourceRef: "redeem:one", pageToken: "opaque" });
    expect(response).toMatchObject({ items: [{ sourceType: "redemption", bucketClass: "permanent",
      relatedHoldCount: "1", relatedExecutionCount: "2", expiresAt: null }], nextPageToken: "next",
      membershipWatermark: "2026-07-30T00:00:00.000Z", observedAt: "2026-07-30T00:00:01.000Z" });
    expect(listCreditGrants).toHaveBeenCalledWith(expect.objectContaining({ siteId: "site-one",
      sourceType: CreditGrantSourceType.REDEMPTION, sourceRef: "redeem:one", pageToken: "opaque",
      pageSize: 100 }), expect.anything());
  });

  it("uses exact allocation oneofs and never maps raw rated evidence", async () => {
    const listCreditHoldAllocations = vi.fn(async () => ({ allocations: [], nextPageToken: undefined,
      membershipWatermark: watermark, observedAt: watermark }));
    const listRatedUsage = vi.fn(async () => ({ ratedUsage: [{
      siteId: "site-one", ratedUsageRef: "55555555-5555-4555-8555-555555555555",
      authorizationSegmentRef: "11111111-1111-4111-8111-111111111111",
      closureRef: "22222222-2222-4222-8222-222222222222",
      settlementRef: "33333333-3333-4333-8333-333333333333",
      evidenceRef: "77777777-7777-4777-8777-777777777777", ratedUsageDigest: "a".repeat(64),
      attemptRef: "attempt:one", executionRootRef: "execution:one",
      creditHoldRef: "44444444-4444-4444-8444-444444444444",
      creditAccountRef: "66666666-6666-4666-8666-666666666666", unit: "credit",
      policyRatedAmount: "10", customerAmount: "9", platformExposureAmount: "1",
      lineItemCount: 1, sourceCount: 1n, createdAt: watermark,
    }], nextPageToken: undefined, membershipWatermark: watermark, observedAt: watermark }));
    const reader = createAdminCreditReader(vi.fn(async () => ({
      rpc: { listCreditHoldAllocations, listRatedUsage }, context: {}, headers: new Headers(),
    })) as never);

    await reader.listCreditHoldAllocations({ siteId: "site-one",
      trace: { kind: "grant", ref: "33333333-3333-4333-8333-333333333333" } });
    expect(listCreditHoldAllocations).toHaveBeenCalledWith(expect.objectContaining({ trace: {
      case: "creditGrantId", value: "33333333-3333-4333-8333-333333333333",
    } }), expect.anything());

    const usage = await reader.listRatedUsage({ siteId: "site-one" });
    expect(usage.items[0]).not.toHaveProperty("evidenceRef");
    expect(usage.items[0]).not.toHaveProperty("ratedUsageDigest");
  });

  it("rejects cross-Site summary, detail and every list item before mapping payload fields", async () => {
    const page = { nextPageToken: undefined, membershipWatermark: watermark, observedAt: watermark };
    const rpc = {
      getSiteCreditSummary: vi.fn(async () => ({ summary: identityOnly({ siteId: wrongSite }) })),
      listCreditAccounts: vi.fn(async () => ({ accounts: [identityOnly({ siteId: wrongSite })], ...page })),
      getCreditAccount: vi.fn(async () => ({ account: identityOnly({ siteId: wrongSite }) })),
      listCreditGrants: vi.fn(async () => ({ grants: [identityOnly({ siteId: wrongSite })], ...page })),
      listCreditHolds: vi.fn(async () => ({ holds: [identityOnly({ siteId: wrongSite })], ...page })),
      listCreditHoldAllocations: vi.fn(async () => ({ allocations: [identityOnly({ siteId: wrongSite })], ...page })),
      listCreditJournalTransactions: vi.fn(async () => ({ transactions: [identityOnly({ siteId: wrongSite })], ...page })),
      listCreditJournalEntries: vi.fn(async () => ({ entries: [identityOnly({ siteId: wrongSite })], ...page })),
      listRatedUsage: vi.fn(async () => ({ ratedUsage: [identityOnly({ siteId: wrongSite })], ...page })),
      listRatedUsageSourceAllocations: vi.fn(async () => ({ allocations: [identityOnly({ siteId: wrongSite })], ...page })),
    };
    const reader = createAdminCreditReader(vi.fn(async () => ({ rpc, context: {}, headers: new Headers() })) as never);
    const accountRef = "11111111-1111-4111-8111-111111111111";
    const transactionRef = "22222222-2222-4222-8222-222222222222";
    const grantRef = "33333333-3333-4333-8333-333333333333";
    const usageRef = "55555555-5555-4555-8555-555555555555";
    const reads = [
      reader.getSiteCreditSummary("site-one"),
      reader.listCreditAccounts({ siteId: "site-one" }),
      reader.getCreditAccount("site-one", accountRef),
      reader.listCreditGrants({ siteId: "site-one" }),
      reader.listCreditHolds({ siteId: "site-one" }),
      reader.listCreditHoldAllocations({ siteId: "site-one", trace: { kind: "grant", ref: grantRef } }),
      reader.listCreditJournalTransactions({ siteId: "site-one" }),
      reader.listCreditJournalEntries({ siteId: "site-one", journalTransactionRef: transactionRef }),
      reader.listRatedUsage({ siteId: "site-one" }),
      reader.listRatedUsageSourceAllocations({ siteId: "site-one", trace: { kind: "usage", ref: usageRef } }),
    ];
    await Promise.all(reads.map((read) => expect(read).rejects.toMatchObject(invalidResponse)));
    expect(rpc.listCreditHoldAllocations).toHaveBeenCalledWith(expect.objectContaining({ trace: {
      case: "creditGrantId", value: grantRef,
    } }), expect.anything());
  });

  it("rejects wrong detail and trace identity keys with one stable invalid-response error", async () => {
    const accountRef = "11111111-1111-4111-8111-111111111111";
    const transactionRef = "22222222-2222-4222-8222-222222222222";
    const grantRef = "33333333-3333-4333-8333-333333333333";
    const holdRef = "44444444-4444-4444-8444-444444444444";
    const usageRef = "55555555-5555-4555-8555-555555555555";
    const settlementRef = "66666666-6666-4666-8666-666666666666";
    const otherRef = "77777777-7777-4777-8777-777777777777";
    const page = { nextPageToken: undefined, membershipWatermark: watermark, observedAt: watermark };
    const rpc = {
      getCreditAccount: vi.fn(async () => ({ account: identityOnly({ siteId: "site-one", creditAccountRef: otherRef }) })),
      listCreditHoldAllocations: vi.fn(async () => ({ allocations: [identityOnly({ siteId: "site-one",
        creditHoldRef: otherRef, creditGrantId: otherRef })], ...page })),
      listCreditJournalEntries: vi.fn(async () => ({ entries: [identityOnly({ siteId: "site-one",
        journalTransactionRef: otherRef })], ...page })),
      listRatedUsageSourceAllocations: vi.fn(async () => ({ allocations: [identityOnly({ siteId: "site-one",
        ratedUsageRef: otherRef, settlementRef: otherRef })], ...page })),
    };
    const reader = createAdminCreditReader(vi.fn(async () => ({ rpc, context: {}, headers: new Headers() })) as never);
    await expect(reader.getCreditAccount("site-one", accountRef)).rejects.toMatchObject(invalidResponse);
    await expect(reader.listCreditHoldAllocations({ siteId: "site-one", trace: { kind: "grant", ref: grantRef } }))
      .rejects.toMatchObject(invalidResponse);
    await expect(reader.listCreditHoldAllocations({ siteId: "site-one", trace: { kind: "hold", ref: holdRef } }))
      .rejects.toMatchObject(invalidResponse);
    await expect(reader.listCreditJournalEntries({ siteId: "site-one", journalTransactionRef: transactionRef }))
      .rejects.toMatchObject(invalidResponse);
    await expect(reader.listRatedUsageSourceAllocations({ siteId: "site-one", trace: { kind: "usage", ref: usageRef } }))
      .rejects.toMatchObject(invalidResponse);
    await expect(reader.listRatedUsageSourceAllocations({ siteId: "site-one",
      trace: { kind: "settlement", ref: settlementRef } })).rejects.toMatchObject(invalidResponse);
  });
});
