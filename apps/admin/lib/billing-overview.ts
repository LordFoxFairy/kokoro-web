import { z } from "zod";
import { apiGet, queryString } from "./api";

export interface BillingOverviewAccess {
  siteId: string;
  canRead: boolean;
}

export interface SettledBillingOverview {
  siteId: string;
  data: BillingOverview | null;
}

export type BillingOverviewFetcher = (path: string) => Promise<BillingOverview>;

const billingOverviewSchema = z.object({
  credit: z
    .object({
      accountsTotal: z.number(),
      accountsActive: z.number(),
      balanceSumMicros: z.string(),
      heldSumMicros: z.string(),
      grantedTotalMicros: z.string(),
      spentTotalMicros: z.string(),
    })
    .nullable(),
  payment: z
    .object({
      ordersTotal: z.number(),
      ordersPaid: z.number(),
      ordersPending: z.number(),
      ordersRefunded: z.number(),
      ordersCanceled: z.number(),
      revenueByCurrency: z.array(z.object({ currency: z.string(), amountMinor: z.string() })),
    })
    .nullable(),
});

export type BillingOverview = z.infer<typeof billingOverviewSchema>;

export function billingOverviewRequestKey(access: BillingOverviewAccess): string | null {
  return access.canRead && access.siteId.length > 0 ? access.siteId : null;
}

export function startBillingOverviewRequest(
  access: BillingOverviewAccess,
  onSettled: (result: SettledBillingOverview) => void,
  fetcher: BillingOverviewFetcher = (path) => apiGet(path, billingOverviewSchema),
): () => void {
  const siteId = billingOverviewRequestKey(access);
  if (siteId === null) return () => {};

  let cancelled = false;
  void fetcher(`/api/billing-overview?${queryString({ siteId })}`)
    .then((data) => {
      if (!cancelled) onSettled({ siteId, data });
    })
    .catch(() => {
      if (!cancelled) onSettled({ siteId, data: null });
    });
  return () => {
    cancelled = true;
  };
}
