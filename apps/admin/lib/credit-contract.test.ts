import { describe, expect, it } from "vitest";

import {
  creditGrantListSchema,
  formatCreditDecimal,
  pairedSourceFilter,
  ratedUsageListSchema,
} from "./credit-contract";

describe("Admin Credit browser contract", () => {
  it("formats 38-digit signed amounts without converting through Number", () => {
    expect(formatCreditDecimal("12345678901234567890123456789012345678")).toBe(
      "12,345,678,901,234,567,890,123,456,789,012,345,678",
    );
    expect(formatCreditDecimal("-10000000000000000001")).toBe("-10,000,000,000,000,000,001");
  });

  it("requires source type and source reference as one identity", () => {
    expect(pairedSourceFilter("redemption", "redeem:one")).toEqual({
      sourceType: "redemption",
      sourceRef: "redeem:one",
    });
    expect(pairedSourceFilter("", "")).toEqual({});
    expect(() => pairedSourceFilter("redemption", "")).toThrow("admin_credit_source_filter_incomplete");
    expect(() => pairedSourceFilter("", "redeem:one")).toThrow("admin_credit_source_filter_incomplete");
  });

  it("rejects unsafe numeric coercion and undeclared evidence fields", () => {
    const base = {
      items: [], nextPageToken: null,
      membershipWatermark: "2026-07-30T00:00:00.000Z",
      observedAt: "2026-07-30T00:00:01.000Z",
    };
    expect(() => creditGrantListSchema.parse({ ...base, items: [{
      siteId: "site-one", creditGrantId: "33333333-3333-4333-8333-333333333333",
      creditAccountRef: "11111111-1111-4111-8111-111111111111", billingAccountRef: "billing:one",
      creditProgramRevisionRef: "program:v1", sourceType: "redemption", sourceRef: "redeem:one",
      issuanceJournalTransactionRef: "22222222-2222-4222-8222-222222222222", bucketClass: "permanent",
      unit: "credit", originalAmount: 9007199254740992, burnPriority: 1,
      effectiveAt: "2026-07-30T00:00:00.000Z", expiresAt: null,
      issuedAt: "2026-07-30T00:00:00.000Z", relatedHoldCount: "1", relatedExecutionCount: "1",
    }] })).toThrow();

    expect(() => ratedUsageListSchema.parse({ ...base, items: [{
      siteId: "site-one", ratedUsageRef: "55555555-5555-4555-8555-555555555555",
      authorizationSegmentRef: "11111111-1111-4111-8111-111111111111",
      closureRef: "22222222-2222-4222-8222-222222222222",
      settlementRef: "33333333-3333-4333-8333-333333333333", attemptRef: "attempt:one",
      executionRootRef: "execution:one", creditHoldRef: "44444444-4444-4444-8444-444444444444",
      creditAccountRef: "66666666-6666-4666-8666-666666666666", unit: "credit",
      policyRatedAmount: "10", customerAmount: "9", platformExposureAmount: "1",
      lineItemCount: 1, sourceCount: "1", createdAt: "2026-07-30T00:00:00.000Z",
      evidenceRef: "must-not-cross-browser-boundary",
    }] })).toThrow();
  });
});
