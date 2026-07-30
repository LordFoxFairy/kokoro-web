import { creditSourceTypeSchema, pairedSourceFilter } from "./credit-contract";

export type CreditView = "accounts" | "grants" | "holds" | "journal" | "usage";
export type CreditFilters = Readonly<Record<string, string | undefined>>;
export interface CreditNavigation { readonly view: CreditView; readonly filters: CreditFilters }
export type UsageSourceTrace = Readonly<{ kind: "usage" | "settlement"; ref: string }>;

const FILTER_KEYS = new Set([
  "billingAccountRef", "creditAccountRef", "creditGrantId", "creditHoldRef", "sourceType", "sourceRef",
  "executionRootRef", "attemptRef", "journalTransactionRef", "ratedUsageRef", "settlementRef",
]);

export function grantToHolds(creditGrantId: string): CreditNavigation {
  return Object.freeze({ view: "holds", filters: Object.freeze({ creditGrantId }) });
}

export function holdToUsage(creditHoldRef: string): CreditNavigation {
  return Object.freeze({ view: "usage", filters: Object.freeze({ creditHoldRef }) });
}

export function sourceAllocationToGrant(creditGrantId: string): CreditNavigation {
  return Object.freeze({ view: "grants", filters: Object.freeze({ creditGrantId }) });
}

export function openUsageSourceTrace(kind: UsageSourceTrace["kind"], ref: string): UsageSourceTrace {
  return Object.freeze({ kind, ref });
}

export function creditQuery(siteId: string, filters: CreditFilters = {}, pageToken?: string): string {
  const sourceType = filters.sourceType === undefined ? "" : creditSourceTypeSchema.parse(filters.sourceType);
  pairedSourceFilter(sourceType, filters.sourceRef ?? "");
  const query = new URLSearchParams({ siteId });
  for (const [key, value] of Object.entries(filters)) {
    if (FILTER_KEYS.has(key) && value !== undefined && value.length > 0) query.set(key, value);
  }
  if (pageToken !== undefined) query.set("pageToken", pageToken);
  return query.toString();
}
