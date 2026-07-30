import { apiGet, queryString } from "./api";
import { siteCreditSummarySchema, type SiteCreditSummary } from "./credit-contract";

export interface CreditSummaryAccess {
  readonly siteId: string;
  readonly canRead: boolean;
}

export interface SettledCreditSummary {
  readonly siteId: string;
  readonly data: SiteCreditSummary | null;
}

export type CreditSummary = SiteCreditSummary;
export type CreditSummaryFetcher = (path: string) => Promise<SiteCreditSummary>;

export function creditSummaryRequestKey(access: CreditSummaryAccess): string | null {
  return access.canRead && access.siteId.length > 0 ? access.siteId : null;
}

export function startCreditSummaryRequest(
  access: CreditSummaryAccess,
  onSettled: (result: SettledCreditSummary) => void,
  fetcher: CreditSummaryFetcher = (path) => apiGet(path, siteCreditSummarySchema),
): () => void {
  const siteId = creditSummaryRequestKey(access);
  if (siteId === null) return () => {};

  let cancelled = false;
  void fetcher(`/api/control/credit/summary?${queryString({ siteId })}`)
    .then((data) => {
      if (!cancelled) onSettled({ siteId, data: data.siteId === siteId ? data : null });
    })
    .catch(() => {
      if (!cancelled) onSettled({ siteId, data: null });
    });
  return () => { cancelled = true; };
}
