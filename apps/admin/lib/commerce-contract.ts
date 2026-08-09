import { z } from "zod";

const UINT64_MAXIMUM = 18_446_744_073_709_551_615n;
const UINT64_PATTERN = /^(?:0|[1-9][0-9]{0,19})$/u;
const positiveUint64Schema = z.string().refine((value) =>
  UINT64_PATTERN.test(value) && value !== "0" && BigInt(value) <= UINT64_MAXIMUM);
const refSchema = z.string().min(1).max(256);
const siteIdSchema = z.string().min(1).max(128);
const safeLabelSchema = z.string().min(1).max(160).refine((value) => value === value.trim());
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const instantSchema = z.string().datetime();
const optionalInstantInput = instantSchema.optional();
export const commerceCursorSchema = z.string().min(1).max(2048);
const nullableCursorSchema = commerceCursorSchema.nullable();

export const commerceReceiptSchema = z.object({
  commandId: z.string().uuid(),
  operation: z.string().min(1).max(128),
  state: z.literal("committed"),
  recordedAt: instantSchema,
}).strict();

const scopePolicySchema = z.object({
  policyVersion: z.literal(1),
  surfaceRefs: z.array(z.string().min(1).max(256)).min(1).max(256),
  capabilityKeys: z.array(z.string().min(1).max(256)).min(1).max(256),
  agentRefs: z.array(z.string().min(1).max(256)).max(256),
  allowUnattributedAgent: z.boolean(),
}).strict();

export const creditProgramSchema = z.object({
  id: refSchema,
  siteId: siteIdSchema,
  creditProgramRevisionRef: refSchema,
  programRef: refSchema,
  revision: positiveUint64Schema,
  bucketClass: z.enum(["daily", "period", "permanent"]),
  unit: z.string().min(1).max(64),
  amount: z.string().regex(/^[1-9][0-9]{0,37}$/u),
  burnPriority: z.number().int(),
  scopePolicy: scopePolicySchema,
  liabilityMerchantAccountRef: refSchema,
  windowKind: z.enum(["none", "daily", "period"]),
  rolloverPolicy: z.literal("none"),
  calendarZone: z.string().min(1).max(64).nullable(),
  windowAnchor: z.string().min(1).max(64).nullable(),
  expiresAfterSeconds: positiveUint64Schema.nullable(),
  revisionDigest: digestSchema,
  publishedAt: instantSchema,
}).strict();

export const entitlementTemplateSchema = z.object({
  id: refSchema,
  siteId: siteIdSchema,
  entitlementTemplateRevisionRef: refSchema,
  templateRef: refSchema,
  revision: positiveUint64Schema,
  capabilityKey: z.string().min(1).max(128),
  safeLabel: safeLabelSchema,
  expiresAfterSeconds: positiveUint64Schema.nullable(),
  revisionDigest: digestSchema,
  publishedAt: instantSchema,
}).strict();

const planVersionSchema = z.object({
  planRef: refSchema,
  planVersionRef: refSchema,
  revision: positiveUint64Schema,
  safeLabel: safeLabelSchema,
  termAction: z.enum(["none", "new_subscription", "extend_from_max", "reject_if_active"]),
  termSeconds: positiveUint64Schema.nullable(),
  stackingScope: z.string().min(1).max(128),
  revisionDigest: digestSchema,
}).strict();

const fulfillmentOutputSchema = z.object({
  outputLineId: refSchema,
  ordinal: z.number().int().min(1).max(32),
  cardinality: z.number().int().min(1).max(32),
  outputKind: z.enum(["subscription_term", "entitlement_grant", "credit_grant",
    "credit_program_enrollment"]),
  targetRevisionRef: refSchema,
}).strict();

export const offerSchema = z.object({
  id: refSchema,
  siteId: siteIdSchema,
  productRef: refSchema,
  productKind: z.enum(["free", "credit_pack", "subscription", "bundle"]),
  productVersionRef: refSchema,
  revision: positiveUint64Schema,
  safeLabel: safeLabelSchema,
  planVersion: planVersionSchema.nullable(),
  fulfillmentProgramRevisionRef: refSchema,
  outputs: z.array(fulfillmentOutputSchema).min(1).max(1000),
  legalTermRefs: z.array(refSchema).max(100),
  publishedAt: instantSchema,
}).strict();

export const redemptionProgramSchema = z.object({
  id: refSchema,
  siteId: siteIdSchema,
  redemptionProgramRevisionRef: refSchema,
  programRef: refSchema,
  revision: positiveUint64Schema,
  productVersionRef: refSchema,
  fulfillmentProgramRevisionRef: refSchema,
  maxRedemptionsPerAccount: z.number().int().min(1).max(10_000),
  availabilityState: z.enum(["active", "paused", "retired"]),
  publishedAt: instantSchema,
}).strict();

const exportReceiptSchema = z.object({
  batchRef: z.string().uuid(),
  exportCommandId: z.string().uuid(),
  exportedToOperatorRef: refSchema,
  codeCount: z.number().int().min(1).max(1000),
  exportedAt: instantSchema,
}).strict();

export const codeBatchSchema = z.object({
  id: z.string().uuid(),
  siteId: siteIdSchema,
  batchRef: z.string().uuid(),
  redemptionProgramRevisionRef: refSchema,
  state: z.enum(["draft", "active", "suspended", "abandoned", "revoked"]),
  approvalState: z.enum(["pending", "approved"]),
  inventoryCount: z.number().int().min(1).max(1000),
  createdByOperatorRef: refSchema,
  startsAt: instantSchema.nullable(),
  endsAt: instantSchema.nullable(),
  createdAt: instantSchema,
  activatedAt: instantSchema.nullable(),
  exportReceipt: exportReceiptSchema,
}).strict();

export function commerceListSchema<Item extends z.ZodTypeAny>(item: Item) {
  return z.object({ items: z.array(item).max(200), nextPageToken: nullableCursorSchema,
    observedAt: instantSchema }).strict();
}

export const creditProgramListSchema = commerceListSchema(creditProgramSchema);
export const entitlementTemplateListSchema = commerceListSchema(entitlementTemplateSchema);
export const offerListSchema = commerceListSchema(offerSchema);
export const redemptionProgramListSchema = commerceListSchema(redemptionProgramSchema);
export const codeBatchListSchema = commerceListSchema(codeBatchSchema);

export const publishCreditProgramInputSchema = z.object({
  siteId: siteIdSchema,
  creditProgramRevisionRef: refSchema,
  programRef: refSchema,
  revision: positiveUint64Schema,
  bucketClass: z.enum(["daily", "period", "permanent"]),
  unit: z.string().min(1).max(64),
  amount: z.string().regex(/^[1-9][0-9]{0,37}$/u),
  burnPriority: z.number().int().min(-2_147_483_648).max(2_147_483_647),
  scopePolicy: scopePolicySchema,
  liabilityMerchantAccountRef: refSchema,
  calendarZone: z.string().min(1).max(64).optional(),
  windowAnchor: z.string().min(1).max(64).optional(),
  expiresAfterSeconds: positiveUint64Schema.optional(),
}).strict();

export const publishEntitlementTemplateInputSchema = z.object({
  siteId: siteIdSchema,
  entitlementTemplateRevisionRef: refSchema,
  templateRef: refSchema,
  revision: positiveUint64Schema,
  capabilityKey: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/u),
  safeLabel: safeLabelSchema,
  expiresAfterSeconds: positiveUint64Schema.optional(),
}).strict();

const planVersionInputSchema = planVersionSchema.omit({ revisionDigest: true });
export const publishOfferInputSchema = z.object({
  siteId: siteIdSchema,
  productRef: refSchema,
  productKind: z.enum(["free", "credit_pack", "subscription", "bundle"]),
  productVersionRef: refSchema,
  productRevision: positiveUint64Schema,
  safeLabel: safeLabelSchema,
  planVersion: planVersionInputSchema.optional(),
  fulfillmentProgramRevisionRef: refSchema,
  fulfillmentProgramRef: refSchema,
  fulfillmentProgramRevision: positiveUint64Schema,
  outputs: z.array(fulfillmentOutputSchema).min(1).max(1000),
  legalTermRefs: z.array(refSchema).max(100),
}).strict();

export const publishRedemptionProgramInputSchema = z.object({
  siteId: siteIdSchema,
  redemptionProgramRevisionRef: refSchema,
  programRef: refSchema,
  revision: positiveUint64Schema,
  productVersionRef: refSchema,
  fulfillmentProgramRevisionRef: refSchema,
  maxRedemptionsPerAccount: z.number().int().min(1).max(10_000),
}).strict();

export const issueCodeBatchInputSchema = z.object({
  siteId: siteIdSchema,
  batchRef: z.string().uuid(),
  redemptionProgramRevisionRef: refSchema,
  count: z.number().int().min(1).max(1000),
  startsAt: optionalInstantInput,
  endsAt: optionalInstantInput,
}).strict().refine((value) => value.startsAt === undefined || value.endsAt === undefined ||
  Date.parse(value.endsAt) > Date.parse(value.startsAt), { path: ["endsAt"] });

export const codeBatchReasonInputSchema = z.object({
  siteId: siteIdSchema,
  reason: z.string().min(1).max(1000),
}).strict();

export const codeBatchSiteInputSchema = z.object({ siteId: siteIdSchema }).strict();

export const publicationResultSchema = z.object({
  id: refSchema,
  disposition: z.enum(["committed", "replayed"]),
  publishedAt: instantSchema,
  revisionDigest: digestSchema.nullable(),
  receipt: commerceReceiptSchema,
}).strict();

const rawCodeSchema = z.string().regex(
  /^KC1-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{10}-[0-9A-HJKMNP-TV-Z]{32}-[0-9A-HJKMNP-TV-Z]{8}$/u,
);
export const issueCodeBatchResultSchema = z.object({
  batchRef: z.string().uuid(),
  codeCount: z.number().int().min(1).max(1000),
  redemptionProgramRevisionRef: refSchema,
  createdByOperatorRef: refSchema,
  startsAt: instantSchema.nullable(),
  endsAt: instantSchema.nullable(),
  exportedAt: instantSchema,
  disposition: z.enum(["committed", "replayed"]),
  delivery: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("secret_export"), rawCodes: z.array(rawCodeSchema).min(1).max(1000) }).strict(),
    z.object({ kind: z.literal("delivery_unavailable"),
      requiredAction: z.literal("abandon_and_reissue") }).strict(),
  ]),
  receipt: commerceReceiptSchema,
}).strict();

export const codeBatchMutationResultSchema = z.object({
  batchRef: z.string().uuid(),
  state: z.enum(["draft", "active", "suspended", "abandoned", "revoked"]),
  approvalState: z.enum(["pending", "approved"]).nullable(),
  changedAt: instantSchema,
  disposition: z.enum(["committed", "replayed"]),
  receipt: commerceReceiptSchema,
}).strict();

export type AdminCreditProgram = z.output<typeof creditProgramSchema>;
export type AdminEntitlementTemplate = z.output<typeof entitlementTemplateSchema>;
export type AdminOffer = z.output<typeof offerSchema>;
export type AdminRedemptionProgram = z.output<typeof redemptionProgramSchema>;
export type AdminCodeBatch = z.output<typeof codeBatchSchema>;
export type PublishCreditProgramInput = z.output<typeof publishCreditProgramInputSchema>;
export type PublishEntitlementTemplateInput = z.output<typeof publishEntitlementTemplateInputSchema>;
export type PublishOfferInput = z.output<typeof publishOfferInputSchema>;
export type PublishRedemptionProgramInput = z.output<typeof publishRedemptionProgramInputSchema>;
export type IssueCodeBatchInput = z.output<typeof issueCodeBatchInputSchema>;
