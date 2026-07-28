import { describe, expect, it, vi } from "vitest";
import {
  billingOverviewRequestKey,
  startBillingOverviewRequest,
  type BillingOverview,
} from "./billing-overview";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const emptyOverview: BillingOverview = { credit: null };

describe("billing overview page request", () => {
  it("requires billing.read and a selected Site", () => {
    expect(billingOverviewRequestKey({ siteId: "site-a", canRead: false })).toBeNull();
    expect(billingOverviewRequestKey({ siteId: "", canRead: true })).toBeNull();
    expect(billingOverviewRequestKey({ siteId: "site-a", canRead: true })).toBe("site-a");
  });

  it("requests the selected Site with URLSearchParams encoding", async () => {
    const fetcher = vi.fn().mockResolvedValue(emptyOverview);
    const onSettled = vi.fn();

    startBillingOverviewRequest({ siteId: "site /?", canRead: true }, onSettled, fetcher);
    await Promise.resolve();

    expect(fetcher).toHaveBeenCalledWith("/api/billing-overview?siteId=site+%2F%3F");
    expect(onSettled).toHaveBeenCalledWith({ siteId: "site /?", data: emptyOverview });
  });

  it("does not request without permission or a selected Site", () => {
    const fetcher = vi.fn().mockResolvedValue(emptyOverview);
    const onSettled = vi.fn();

    startBillingOverviewRequest({ siteId: "site-a", canRead: false }, onSettled, fetcher);
    startBillingOverviewRequest({ siteId: "", canRead: true }, onSettled, fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("ignores an old response after the selected Site changes", async () => {
    const siteA = deferred<BillingOverview>();
    const siteB = deferred<BillingOverview>();
    const fetcher = vi.fn((path: string) => (path.endsWith("siteId=site-a") ? siteA.promise : siteB.promise));
    const onSettled = vi.fn();

    const cancelSiteA = startBillingOverviewRequest({ siteId: "site-a", canRead: true }, onSettled, fetcher);
    cancelSiteA();
    startBillingOverviewRequest({ siteId: "site-b", canRead: true }, onSettled, fetcher);

    const siteBOverview: BillingOverview = {
      ...emptyOverview,
      credit: {
        accountsTotal: 2,
        accountsActive: 1,
        balanceSumMicros: "20",
        heldSumMicros: "0",
        grantedTotalMicros: "20",
        spentTotalMicros: "0",
      },
    };
    siteB.resolve(siteBOverview);
    await Promise.resolve();
    siteA.resolve(emptyOverview);
    await Promise.resolve();

    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      "/api/billing-overview?siteId=site-a",
      "/api/billing-overview?siteId=site-b",
    ]);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith({ siteId: "site-b", data: siteBOverview });
  });
});
