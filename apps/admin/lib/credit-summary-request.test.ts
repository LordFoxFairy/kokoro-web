import { describe, expect, it, vi } from "vitest";

type CreditSummary = ReturnType<typeof summary>;

async function subject() {
  const loaded = await import("./credit-summary-request").catch(() => null);
  expect(loaded).not.toBeNull();
  return loaded;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const summary = (siteId: string, availableAmount = "900719925474099312345") => ({
  siteId,
  creditAccountCount: "9007199254740993",
  activeCreditAccountCount: "2",
  openHoldCount: "3",
  reconciliationRequiredHoldCount: "1",
  balances: [{ unit: "credit", availableAmount, reservedAmount: "20", consumedAmount: "30",
    expiredAmount: "0", revokedAmount: "0", recoveryExposureAmount: "1" }],
  freshness: "database_observation" as const,
  asOf: "2026-07-30T00:00:00.000Z",
});

describe("home Credit summary request", () => {
  it("requires Credit read authority and calls only the typed summary route", async () => {
    const credit = await subject(); if (credit === null) return;
    expect(credit.creditSummaryRequestKey({ siteId: "site-a", canRead: false })).toBeNull();
    const fetcher = vi.fn().mockResolvedValue(summary("site /?"));
    const settled = vi.fn();
    credit.startCreditSummaryRequest({ siteId: "site /?", canRead: true }, settled, fetcher);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledWith("/api/control/credit/summary?siteId=site+%2F%3F");
    expect(settled).toHaveBeenCalledWith({ siteId: "site /?", data: expect.objectContaining({
      creditAccountCount: "9007199254740993",
      balances: [expect.objectContaining({ availableAmount: "900719925474099312345" })],
    }) });
  });

  it("drops cancelled cross-Site responses and rejects a mismatched response Site", async () => {
    const credit = await subject(); if (credit === null) return;
    const siteA = deferred<CreditSummary>();
    const siteB = deferred<CreditSummary>();
    const fetcher = vi.fn((path: string) => path.endsWith("siteId=site-a") ? siteA.promise : siteB.promise);
    const settled = vi.fn();
    const cancelA = credit.startCreditSummaryRequest({ siteId: "site-a", canRead: true }, settled, fetcher);
    cancelA();
    credit.startCreditSummaryRequest({ siteId: "site-b", canRead: true }, settled, fetcher);
    siteB.resolve(summary("site-wrong"));
    await Promise.resolve();
    siteA.resolve(summary("site-a"));
    await Promise.resolve();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ siteId: "site-b", data: null });
  });
});
