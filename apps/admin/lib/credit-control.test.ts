import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  getSiteCreditSummary: vi.fn(), listCreditAccounts: vi.fn(), getCreditAccount: vi.fn(),
  listCreditGrants: vi.fn(), listCreditHolds: vi.fn(), listCreditHoldAllocations: vi.fn(),
  listCreditJournalTransactions: vi.fn(), listCreditJournalEntries: vi.fn(), listRatedUsage: vi.fn(),
  listRatedUsageSourceAllocations: vi.fn(),
}));

vi.mock("@/lib/control-plane/credit-client", () => ({ adminCreditReader: calls }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const call of Object.values(calls)) call.mockResolvedValue({ items: [], nextPageToken: null,
    membershipWatermark: "2026-07-30T00:00:00.000Z", observedAt: "2026-07-30T00:00:00.000Z" });
  calls.getSiteCreditSummary.mockResolvedValue({ siteId: "site-one" });
  calls.getCreditAccount.mockResolvedValue({ siteId: "site-one", creditAccountRef: "11111111-1111-4111-8111-111111111111" });
});

describe("typed Admin Credit BFF routes", () => {
  it("exposes summary, account list and account detail as bounded Site reads", async () => {
    const summary = await import("../app/api/control/credit/summary/route");
    const accounts = await import("../app/api/control/credit/accounts/route");
    const account = await import("../app/api/control/credit/accounts/[accountRef]/route");

    expect((await summary.GET(request("/summary?siteId=site-one"))).status).toBe(200);
    expect((await accounts.GET(request("/accounts?siteId=site-one&billingAccountRef=billing%3Aone&pageToken=opaque"))).status).toBe(200);
    expect((await account.GET(request("/accounts/one?siteId=site-one"), { params: Promise.resolve({
      accountRef: "11111111-1111-4111-8111-111111111111",
    }) })).status).toBe(200);
    expect(calls.getSiteCreditSummary).toHaveBeenCalledWith("site-one");
    expect(calls.listCreditAccounts).toHaveBeenCalledWith({ siteId: "site-one",
      billingAccountRef: "billing:one", pageToken: "opaque" });
    expect(calls.getCreditAccount).toHaveBeenCalledWith("site-one", "11111111-1111-4111-8111-111111111111");
  });

  it("accepts only a complete Grant source identity", async () => {
    const grants = await import("../app/api/control/credit/grants/route");
    const valid = await grants.GET(request("/grants?siteId=site-one&sourceType=redemption&sourceRef=redeem%3Aone"));
    expect(valid.status).toBe(200);
    expect(calls.listCreditGrants).toHaveBeenCalledWith({ siteId: "site-one",
      sourceType: "redemption", sourceRef: "redeem:one" });

    const invalid = await grants.GET(request("/grants?siteId=site-one&sourceRef=redeem%3Aone"));
    expect(invalid.status).toBe(400);
    expect(calls.listCreditGrants).toHaveBeenCalledTimes(1);
  });

  it("maps Grant and Hold drill-downs to exact allocation oneofs", async () => {
    const route = await import("../app/api/control/credit/hold-allocations/route");
    const grantRef = "33333333-3333-4333-8333-333333333333";
    const holdRef = "44444444-4444-4444-8444-444444444444";
    expect((await route.GET(request(`/hold-allocations?siteId=site-one&creditGrantId=${grantRef}`))).status).toBe(200);
    expect(calls.listCreditHoldAllocations).toHaveBeenLastCalledWith({ siteId: "site-one",
      trace: { kind: "grant", ref: grantRef } });
    expect((await route.GET(request(`/hold-allocations?siteId=site-one&creditHoldRef=${holdRef}`))).status).toBe(200);
    expect(calls.listCreditHoldAllocations).toHaveBeenLastCalledWith({ siteId: "site-one",
      trace: { kind: "hold", ref: holdRef } });
    expect((await route.GET(request(`/hold-allocations?siteId=site-one&creditHoldRef=${holdRef}&creditGrantId=${grantRef}`))).status).toBe(400);
  });

  it("binds Hold, Journal and Usage filters without arbitrary route parameters", async () => {
    const holds = await import("../app/api/control/credit/holds/route");
    const transactions = await import("../app/api/control/credit/journal-transactions/route");
    const entries = await import("../app/api/control/credit/journal-entries/route");
    const usage = await import("../app/api/control/credit/rated-usage/route");
    const accountRef = "11111111-1111-4111-8111-111111111111";
    const holdRef = "44444444-4444-4444-8444-444444444444";
    const transactionRef = "22222222-2222-4222-8222-222222222222";

    expect((await holds.GET(request(`/holds?siteId=site-one&creditAccountRef=${accountRef}`))).status).toBe(200);
    expect((await transactions.GET(request(`/journal?siteId=site-one&creditHoldRef=${holdRef}`))).status).toBe(200);
    expect((await entries.GET(request(`/entries?siteId=site-one&journalTransactionRef=${transactionRef}`))).status).toBe(200);
    expect((await usage.GET(request(`/usage?siteId=site-one&creditHoldRef=${holdRef}&attemptRef=attempt%3Aone`))).status).toBe(200);
    expect(calls.listRatedUsage).toHaveBeenCalledWith({ siteId: "site-one", creditHoldRef: holdRef,
      attemptRef: "attempt:one" });
    expect((await usage.GET(request("/usage?siteId=site-one&providerPayload=raw"))).status).toBe(400);
  });

  it("maps Usage and Settlement drill-downs to exact source-allocation oneofs", async () => {
    const route = await import("../app/api/control/credit/rated-usage-source-allocations/route");
    const usageRef = "55555555-5555-4555-8555-555555555555";
    const settlementRef = "66666666-6666-4666-8666-666666666666";
    expect((await route.GET(request(`/sources?siteId=site-one&ratedUsageRef=${usageRef}`))).status).toBe(200);
    expect(calls.listRatedUsageSourceAllocations).toHaveBeenLastCalledWith({ siteId: "site-one",
      trace: { kind: "usage", ref: usageRef } });
    expect((await route.GET(request(`/sources?siteId=site-one&settlementRef=${settlementRef}`))).status).toBe(200);
    expect(calls.listRatedUsageSourceAllocations).toHaveBeenLastCalledWith({ siteId: "site-one",
      trace: { kind: "settlement", ref: settlementRef } });
  });
});

function request(path: string): Request {
  return new Request(`https://admin.example/api/control/credit${path}`);
}
