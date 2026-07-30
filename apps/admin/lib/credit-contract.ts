import { z } from "zod";

const ref = z.string().min(1).max(256);
const uuid = z.string().uuid();
const instant = z.string().datetime();
const decimal = z.string().regex(/^-?[0-9]{1,38}$/u);
const unsignedDecimal = z.string().regex(/^[0-9]{1,38}$/u);
const positiveDecimal = z.string().regex(/^[1-9][0-9]{0,37}$/u);
const count = unsignedDecimal;

export const creditSourceTypeSchema = z.enum(["redemption", "payment", "admin_grant", "program_window"]);
export type CreditSourceType = z.infer<typeof creditSourceTypeSchema>;

export const creditBalanceSchema = z.object({
  unit: ref,
  availableAmount: decimal,
  reservedAmount: decimal,
  consumedAmount: decimal,
  expiredAmount: decimal,
  revokedAmount: decimal,
  recoveryExposureAmount: decimal,
}).strict();

export const siteCreditSummarySchema = z.object({
  siteId: z.string().min(1).max(128),
  creditAccountCount: count,
  activeCreditAccountCount: count,
  openHoldCount: count,
  reconciliationRequiredHoldCount: count,
  balances: z.array(creditBalanceSchema).max(64),
  freshness: z.literal("database_observation"),
  asOf: instant,
}).strict();

export const creditAccountSchema = z.object({
  siteId: z.string().min(1).max(128),
  creditAccountRef: uuid,
  billingAccountRef: ref,
  unit: ref,
  state: z.enum(["active", "suspended", "closed"]),
  aggregateVersion: positiveDecimal,
  balance: creditBalanceSchema,
  grantCount: count,
  openHoldCount: count,
  reconciliationRequiredHoldCount: count,
  createdAt: instant,
  updatedAt: instant,
  freshness: z.literal("database_observation"),
  asOf: instant,
}).strict();

export const creditGrantSchema = z.object({
  siteId: z.string().min(1).max(128),
  creditGrantId: uuid,
  creditAccountRef: uuid,
  billingAccountRef: ref,
  creditProgramRevisionRef: ref,
  sourceType: creditSourceTypeSchema,
  sourceRef: ref,
  issuanceJournalTransactionRef: uuid,
  bucketClass: z.enum(["daily", "period", "permanent"]),
  unit: ref,
  originalAmount: positiveDecimal,
  burnPriority: z.number().int(),
  effectiveAt: instant,
  expiresAt: instant.nullable(),
  issuedAt: instant,
  relatedHoldCount: count,
  relatedExecutionCount: count,
}).strict();

export const creditHoldSchema = z.object({
  siteId: z.string().min(1).max(128),
  creditHoldRef: uuid,
  creditAccountRef: uuid,
  executionRootRef: ref,
  unit: ref,
  requestedAmount: positiveDecimal,
  reservedAmount: positiveDecimal,
  capturedAmount: unsignedDecimal,
  releasedAmount: unsignedDecimal,
  state: z.enum(["open", "closing", "settled", "released", "expired", "reconciliation_required"]),
  resolutionKind: z.enum(["reservation_expiry", "known_outcome", "reconciled"]).nullable(),
  resolutionRef: ref.nullable(),
  fenceEpoch: positiveDecimal,
  expiresAt: instant,
  settledAt: instant.nullable(),
  releasedAt: instant.nullable(),
  createdAt: instant,
  updatedAt: instant,
  grantCount: count,
  sourceCount: count,
}).strict();

export const creditHoldAllocationSchema = z.object({
  siteId: z.string().min(1).max(128),
  creditHoldRef: uuid,
  creditGrantId: uuid,
  creditAccountRef: uuid,
  unit: ref,
  reserveJournalTransactionRef: uuid,
  allocatedAmount: positiveDecimal,
  allocationOrdinal: z.number().int().nonnegative(),
  createdAt: instant,
}).strict();

export const creditJournalTransactionSchema = z.object({
  siteId: z.string().min(1).max(128),
  journalTransactionRef: uuid,
  creditAccountRef: uuid,
  unit: ref,
  businessOperationKey: ref,
  operationKind: z.enum(["grant_issue", "hold_reserve", "hold_capture", "hold_release",
    "grant_expire", "grant_revoke", "correction", "reversal"]),
  entryCount: z.number().int().min(2).max(512),
  reversalOfTransactionRef: uuid.nullable(),
  occurredAt: instant,
  createdAt: instant,
}).strict();

export const creditJournalEntrySchema = z.object({
  siteId: z.string().min(1).max(128),
  journalTransactionRef: uuid,
  entryOrdinal: z.number().int().nonnegative(),
  creditAccountRef: uuid,
  unit: ref,
  entrySide: z.enum(["debit", "credit"]),
  accountType: z.enum(["grant_issuance_source", "customer_available", "customer_reserved",
    "customer_consumed", "expired", "revoked", "adjustment", "recovery_exposure"]),
  amount: positiveDecimal,
  creditGrantId: uuid,
  creditHoldRef: uuid.nullable(),
  sourceType: creditSourceTypeSchema,
  sourceRef: ref,
  executionRootRef: ref.nullable(),
  createdAt: instant,
}).strict();

export const ratedUsageSchema = z.object({
  siteId: z.string().min(1).max(128),
  ratedUsageRef: uuid,
  authorizationSegmentRef: uuid,
  closureRef: uuid,
  settlementRef: uuid,
  attemptRef: ref,
  executionRootRef: ref,
  creditHoldRef: uuid,
  creditAccountRef: uuid,
  unit: ref,
  policyRatedAmount: unsignedDecimal,
  customerAmount: unsignedDecimal,
  platformExposureAmount: unsignedDecimal,
  lineItemCount: z.number().int().nonnegative(),
  sourceCount: count,
  createdAt: instant,
}).strict();

export const ratedUsageSourceAllocationSchema = z.object({
  siteId: z.string().min(1).max(128),
  ratedUsageRef: uuid,
  settlementRef: uuid,
  creditGrantId: uuid,
  direction: z.enum(["capture", "increase", "decrease"]),
  amount: positiveDecimal,
  allocationOrdinal: z.number().int().nonnegative(),
}).strict();

function listSchema<Item extends z.ZodTypeAny>(item: Item) {
  return z.object({
    items: z.array(item).max(200),
    nextPageToken: z.string().min(1).max(512).nullable(),
    membershipWatermark: instant,
    observedAt: instant,
  }).strict();
}

export const creditAccountListSchema = listSchema(creditAccountSchema);
export const creditGrantListSchema = listSchema(creditGrantSchema);
export const creditHoldListSchema = listSchema(creditHoldSchema);
export const creditHoldAllocationListSchema = listSchema(creditHoldAllocationSchema);
export const creditJournalTransactionListSchema = listSchema(creditJournalTransactionSchema);
export const creditJournalEntryListSchema = listSchema(creditJournalEntrySchema);
export const ratedUsageListSchema = listSchema(ratedUsageSchema);
export const ratedUsageSourceAllocationListSchema = listSchema(ratedUsageSourceAllocationSchema);

export type SiteCreditSummary = z.infer<typeof siteCreditSummarySchema>;
export type CreditAccount = z.infer<typeof creditAccountSchema>;
export type CreditGrant = z.infer<typeof creditGrantSchema>;
export type CreditHold = z.infer<typeof creditHoldSchema>;
export type CreditHoldAllocation = z.infer<typeof creditHoldAllocationSchema>;
export type CreditJournalTransaction = z.infer<typeof creditJournalTransactionSchema>;
export type CreditJournalEntry = z.infer<typeof creditJournalEntrySchema>;
export type RatedUsage = z.infer<typeof ratedUsageSchema>;
export type RatedUsageSourceAllocation = z.infer<typeof ratedUsageSourceAllocationSchema>;

export function formatCreditDecimal(value: string): string {
  if (!/^-?[0-9]{1,38}$/u.test(value)) throw new Error("admin_credit_decimal_invalid");
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const grouped = digits.replace(/\B(?=(?:[0-9]{3})+(?![0-9]))/gu, ",");
  return `${negative ? "-" : ""}${grouped}`;
}

export function pairedSourceFilter(sourceType: CreditSourceType | "", sourceRef: string): Readonly<{
  sourceType?: CreditSourceType;
  sourceRef?: string;
}> {
  const normalizedRef = sourceRef.trim();
  if ((sourceType.length === 0) !== (normalizedRef.length === 0)) {
    throw new Error("admin_credit_source_filter_incomplete");
  }
  if (sourceType === "") return Object.freeze({});
  return Object.freeze({ sourceType, sourceRef: normalizedRef });
}
