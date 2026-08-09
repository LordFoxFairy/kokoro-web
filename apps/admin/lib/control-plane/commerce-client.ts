import "server-only";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Client } from "@connectrpc/connect";
import { Code, ConnectError, createClient } from "@connectrpc/connect";

import type { AdminSurface } from "../admin-surface-permissions";
import {
  commerceCursorSchema,
  issueCodeBatchInputSchema,
  publishCreditProgramInputSchema,
  publishEntitlementTemplateInputSchema,
  publishOfferInputSchema,
  publishRedemptionProgramInputSchema,
  type AdminCodeBatch,
  type AdminCreditProgram,
  type AdminEntitlementTemplate,
  type AdminOffer,
  type AdminRedemptionProgram,
  type IssueCodeBatchInput,
  type PublishCreditProgramInput,
  type PublishEntitlementTemplateInput,
  type PublishOfferInput,
  type PublishRedemptionProgramInput,
} from "../commerce-contract";
import { requireAdminSurfaceSession } from "./admin-surface-authority";
import {
  AdminControlPlaneError,
  authHeaders,
  commandContext,
  queryContext,
  verifiedAxes,
} from "./client";
import { adminControlPlaneTransport } from "./transport";
import {
  activateCodeBatchRequestDigest,
  abandonCodeBatchRequestDigest,
  approveCodeBatchRequestDigest,
  issueCodeBatchRequestDigest,
  publishCreditProgramRevisionRequestDigest,
  publishEntitlementTemplateRevisionRequestDigest,
  publishOfferRevisionRequestDigest,
  publishRedemptionProgramRevisionRequestDigest,
  revokeCodeBatchRequestDigest,
  suspendCodeBatchRequestDigest,
  type VerifiedCommerceSiteAxes,
} from "@/lib/generated/contracts/platform-admin-commerce@v1/digest";
import { KokoroErrorDetailSchema } from "@/lib/generated/proto/kokoro/common/v1/error_pb";
import {
  CommandDigestAlgorithmV2,
  CommandReceiptStateV2,
  type CommandReceiptV2,
} from "@/lib/generated/proto/kokoro/common/v2/command_envelope_pb";
import { AdminCommerceService } from
  "@/lib/generated/proto/kokoro/platform/commerce/v1/admin_commerce_pb";
import {
  CommerceCommandDisposition,
  CommerceFulfillmentOutputKind,
  CommerceFulfillmentOutputSchema,
  CommercePageRequestSchema,
  CommercePlanTermAction,
  CommercePlanVersionInputSchema,
  CommerceProductKind,
  CommerceSiteCommandContextSchema,
  CommerceSiteQueryContextSchema,
  CreditProgramBucketClass,
  CreditProgramRolloverPolicy,
  CreditProgramScopePolicySchema,
  CreditProgramWindowKind,
  PublishCreditProgramRevisionEffectSchema,
  PublishEntitlementTemplateRevisionEffectSchema,
  PublishOfferRevisionEffectSchema,
  PublishRedemptionProgramRevisionEffectSchema,
  RedemptionProgramAvailabilityState,
  type CreditProgramRevisionView,
  type EntitlementTemplateRevisionView,
  type OfferRevisionView,
  type RedemptionProgramRevisionView,
} from "@/lib/generated/proto/kokoro/platform/commerce/v1/commerce_catalog_pb";
import {
  AbandonCodeBatchEffectSchema,
  ActivateCodeBatchEffectSchema,
  ApproveCodeBatchEffectSchema,
  CodeBatchApprovalState,
  CodeBatchRecoveryAction,
  CodeBatchState,
  IssueCodeBatchEffectSchema,
  RevokeCodeBatchEffectSchema,
  SuspendCodeBatchEffectSchema,
  type CodeBatchMutationResult,
  type CodeBatchView,
} from "@/lib/generated/proto/kokoro/platform/commerce/v1/commerce_control_pb";

type CommerceRpc = Client<typeof AdminCommerceService>;
type PageInput = Readonly<{ siteId: string; pageToken?: string }>;
type CommerceList<Item> = Readonly<{
  items: readonly Item[];
  nextPageToken: string | null;
  observedAt: string;
}>;

const READ_SURFACE = Object.freeze({
  creditPrograms: "commerceCreditProgramsRead",
  entitlementTemplates: "commerceEntitlementTemplatesRead",
  offers: "commerceOffersRead",
  redemptionPrograms: "commerceRedemptionProgramsRead",
  codeBatches: "commerceCodeBatchesRead",
} as const satisfies Readonly<Record<string, AdminSurface>>);

async function queryRuntime(siteId: string, surface: AdminSurface) {
  const session = await requireAdminSurfaceSession(surface);
  const context = create(CommerceSiteQueryContextSchema, {
    operator: queryContext(session, { kind: "site", siteId }),
    siteId,
  });
  return {
    rpc: createClient(AdminCommerceService, await adminControlPlaneTransport()),
    context,
    headers: authHeaders(session),
  };
}

async function commandRuntime(siteId: string, surface: AdminSurface) {
  const session = await requireAdminSurfaceSession(surface);
  const operator = commandContext(session, { kind: "site", siteId });
  const context = create(CommerceSiteCommandContextSchema, { operator, siteId });
  return {
    rpc: createClient(AdminCommerceService, await adminControlPlaneTransport()),
    context,
    axes: { ...verifiedAxes(session), siteId } satisfies VerifiedCommerceSiteAxes,
    headers: authHeaders(session, operator.command?.commandId),
  };
}

export const adminCommerceClient = Object.freeze({
  async listCreditPrograms(input: PageInput): Promise<CommerceList<AdminCreditProgram>> {
    const pageToken = optionalCursor(input.pageToken);
    const { rpc, context, headers } = await queryRuntime(input.siteId, READ_SURFACE.creditPrograms);
    return queryCall(async () => {
      const response = await rpc.listCreditProgramRevisions({ context,
        page: create(CommercePageRequestSchema, { pageSize: 100, ...optional("pageToken", pageToken) }) }, { headers });
      assertSiteItems(response.items, input.siteId);
      return listJson(response.items.map(creditProgramJson), response.nextPageToken, response.observedAt);
    });
  },

  async getCreditProgram(siteId: string, id: string): Promise<AdminCreditProgram> {
    const { rpc, context, headers } = await queryRuntime(siteId, READ_SURFACE.creditPrograms);
    return queryCall(async () => {
      const response = await rpc.getCreditProgramRevision({ context, creditProgramRevisionRef: id }, { headers });
      if (response.revision === undefined || response.revision.siteId !== siteId ||
          response.revision.creditProgramRevisionRef !== id) throw invalidResponse();
      return creditProgramJson(response.revision);
    });
  },

  async publishCreditProgram(raw: PublishCreditProgramInput) {
    const input = publishCreditProgramInputSchema.parse(raw);
    const { rpc, context, axes, headers } = await commandRuntime(input.siteId, "commerceCreditProgramsPublish");
    const effect = create(PublishCreditProgramRevisionEffectSchema, {
      creditProgramRevisionRef: input.creditProgramRevisionRef,
      programRef: input.programRef,
      revision: positiveBigInt(input.revision),
      uxBucketClass: bucketClassWire(input.bucketClass),
      unit: input.unit,
      amount: input.amount,
      burnPriority: input.burnPriority,
      scopePolicy: create(CreditProgramScopePolicySchema, input.scopePolicy),
      liabilityMerchantAccountRef: input.liabilityMerchantAccountRef,
      rolloverPolicy: CreditProgramRolloverPolicy.NONE,
      ...optional("calendarZone", input.calendarZone),
      ...optional("windowAnchor", input.windowAnchor),
      ...(input.expiresAfterSeconds === undefined ? {} : {
        expiresAfterSeconds: positiveBigInt(input.expiresAfterSeconds),
      }),
    });
    setDigest(context, publishCreditProgramRevisionRequestDigest(context, effect, axes));
    const response = await commandCall(() => rpc.publishCreditProgramRevision({ context, effect }, { headers }));
    const result = response.result;
    validateReceipt(response.receipt, context, "commerce.credit-program.publish");
    if (result === undefined || result.creditProgramRevisionRef !== input.creditProgramRevisionRef) {
      throw invalidResponse();
    }
    return publicationJson(result.creditProgramRevisionRef, result.publishedAt, result.revisionDigest,
      response.disposition, response.receipt);
  },

  async listEntitlementTemplates(input: PageInput): Promise<CommerceList<AdminEntitlementTemplate>> {
    const pageToken = optionalCursor(input.pageToken);
    const { rpc, context, headers } = await queryRuntime(input.siteId, READ_SURFACE.entitlementTemplates);
    return queryCall(async () => {
      const response = await rpc.listEntitlementTemplateRevisions({ context,
        page: create(CommercePageRequestSchema, { pageSize: 100, ...optional("pageToken", pageToken) }) }, { headers });
      assertSiteItems(response.items, input.siteId);
      return listJson(response.items.map(entitlementTemplateJson), response.nextPageToken, response.observedAt);
    });
  },

  async getEntitlementTemplate(siteId: string, id: string): Promise<AdminEntitlementTemplate> {
    const { rpc, context, headers } = await queryRuntime(siteId, READ_SURFACE.entitlementTemplates);
    return queryCall(async () => {
      const response = await rpc.getEntitlementTemplateRevision({ context,
        entitlementTemplateRevisionRef: id }, { headers });
      if (response.revision === undefined || response.revision.siteId !== siteId ||
          response.revision.entitlementTemplateRevisionRef !== id) throw invalidResponse();
      return entitlementTemplateJson(response.revision);
    });
  },

  async publishEntitlementTemplate(raw: PublishEntitlementTemplateInput) {
    const input = publishEntitlementTemplateInputSchema.parse(raw);
    const { rpc, context, axes, headers } = await commandRuntime(input.siteId,
      "commerceEntitlementTemplatesPublish");
    const effect = create(PublishEntitlementTemplateRevisionEffectSchema, {
      entitlementTemplateRevisionRef: input.entitlementTemplateRevisionRef,
      templateRef: input.templateRef,
      revision: positiveBigInt(input.revision),
      capabilityKey: input.capabilityKey,
      safeLabel: input.safeLabel,
      ...(input.expiresAfterSeconds === undefined ? {} : {
        expiresAfterSeconds: positiveBigInt(input.expiresAfterSeconds),
      }),
    });
    setDigest(context, publishEntitlementTemplateRevisionRequestDigest(context, effect, axes));
    const response = await commandCall(() => rpc.publishEntitlementTemplateRevision({ context, effect }, { headers }));
    const result = response.result;
    validateReceipt(response.receipt, context, "commerce.entitlement-template.publish");
    if (result === undefined || result.entitlementTemplateRevisionRef !== input.entitlementTemplateRevisionRef) {
      throw invalidResponse();
    }
    return publicationJson(result.entitlementTemplateRevisionRef, result.publishedAt, result.revisionDigest,
      response.disposition, response.receipt);
  },

  async listOffers(input: PageInput): Promise<CommerceList<AdminOffer>> {
    const pageToken = optionalCursor(input.pageToken);
    const { rpc, context, headers } = await queryRuntime(input.siteId, READ_SURFACE.offers);
    return queryCall(async () => {
      const response = await rpc.listOfferRevisions({ context,
        page: create(CommercePageRequestSchema, { pageSize: 100, ...optional("pageToken", pageToken) }) }, { headers });
      assertSiteItems(response.items, input.siteId);
      return listJson(response.items.map(offerJson), response.nextPageToken, response.observedAt);
    });
  },

  async getOffer(siteId: string, id: string): Promise<AdminOffer> {
    const { rpc, context, headers } = await queryRuntime(siteId, READ_SURFACE.offers);
    return queryCall(async () => {
      const response = await rpc.getOfferRevision({ context, productVersionRef: id }, { headers });
      if (response.revision === undefined || response.revision.siteId !== siteId ||
          response.revision.productVersionRef !== id) throw invalidResponse();
      return offerJson(response.revision);
    });
  },

  async publishOffer(raw: PublishOfferInput) {
    const input = publishOfferInputSchema.parse(raw);
    const { rpc, context, axes, headers } = await commandRuntime(input.siteId, "commerceOffersPublish");
    const effect = create(PublishOfferRevisionEffectSchema, {
      productRef: input.productRef,
      productKind: productKindWire(input.productKind),
      productVersionRef: input.productVersionRef,
      productRevision: positiveBigInt(input.productRevision),
      safeLabel: input.safeLabel,
      ...(input.planVersion === undefined ? {} : { planVersion: create(CommercePlanVersionInputSchema, {
        planRef: input.planVersion.planRef,
        planVersionRef: input.planVersion.planVersionRef,
        revision: positiveBigInt(input.planVersion.revision),
        safeLabel: input.planVersion.safeLabel,
        termAction: termActionWire(input.planVersion.termAction),
        ...(input.planVersion.termSeconds === null || input.planVersion.termSeconds === undefined ? {} : {
          termSeconds: positiveBigInt(input.planVersion.termSeconds),
        }),
        stackingScope: input.planVersion.stackingScope,
      }) }),
      fulfillmentProgramRevisionRef: input.fulfillmentProgramRevisionRef,
      fulfillmentProgramRef: input.fulfillmentProgramRef,
      fulfillmentProgramRevision: positiveBigInt(input.fulfillmentProgramRevision),
      outputs: input.outputs.map((item) => create(CommerceFulfillmentOutputSchema, {
        ...item,
        outputKind: outputKindWire(item.outputKind),
      })),
      legalTermRefs: [...input.legalTermRefs],
    });
    setDigest(context, publishOfferRevisionRequestDigest(context, effect, axes));
    const response = await commandCall(() => rpc.publishOfferRevision({ context, effect }, { headers }));
    const result = response.result;
    validateReceipt(response.receipt, context, "commerce.offer.publish");
    if (result === undefined || result.productVersionRef !== input.productVersionRef) throw invalidResponse();
    return publicationJson(result.productVersionRef, result.publishedAt, null,
      response.disposition, response.receipt);
  },

  async listRedemptionPrograms(input: PageInput): Promise<CommerceList<AdminRedemptionProgram>> {
    const pageToken = optionalCursor(input.pageToken);
    const { rpc, context, headers } = await queryRuntime(input.siteId, READ_SURFACE.redemptionPrograms);
    return queryCall(async () => {
      const response = await rpc.listRedemptionProgramRevisions({ context,
        page: create(CommercePageRequestSchema, { pageSize: 100, ...optional("pageToken", pageToken) }) }, { headers });
      assertSiteItems(response.items, input.siteId);
      return listJson(response.items.map(redemptionProgramJson), response.nextPageToken, response.observedAt);
    });
  },

  async getRedemptionProgram(siteId: string, id: string): Promise<AdminRedemptionProgram> {
    const { rpc, context, headers } = await queryRuntime(siteId, READ_SURFACE.redemptionPrograms);
    return queryCall(async () => {
      const response = await rpc.getRedemptionProgramRevision({ context,
        redemptionProgramRevisionRef: id }, { headers });
      if (response.revision === undefined || response.revision.siteId !== siteId ||
          response.revision.redemptionProgramRevisionRef !== id) throw invalidResponse();
      return redemptionProgramJson(response.revision);
    });
  },

  async publishRedemptionProgram(raw: PublishRedemptionProgramInput) {
    const input = publishRedemptionProgramInputSchema.parse(raw);
    const { rpc, context, axes, headers } = await commandRuntime(input.siteId,
      "commerceRedemptionProgramsPublish");
    const effect = create(PublishRedemptionProgramRevisionEffectSchema, {
      ...input,
      revision: positiveBigInt(input.revision),
    });
    setDigest(context, publishRedemptionProgramRevisionRequestDigest(context, effect, axes));
    const response = await commandCall(() => rpc.publishRedemptionProgramRevision({ context, effect }, { headers }));
    const result = response.result;
    validateReceipt(response.receipt, context, "commerce.redemption-program.publish");
    if (result === undefined || result.redemptionProgramRevisionRef !== input.redemptionProgramRevisionRef) {
      throw invalidResponse();
    }
    return publicationJson(result.redemptionProgramRevisionRef, result.publishedAt, null,
      response.disposition, response.receipt);
  },

  async listCodeBatches(input: PageInput): Promise<CommerceList<AdminCodeBatch>> {
    const pageToken = optionalCursor(input.pageToken);
    const { rpc, context, headers } = await queryRuntime(input.siteId, READ_SURFACE.codeBatches);
    return queryCall(async () => {
      const response = await rpc.listCodeBatches({ context,
        page: create(CommercePageRequestSchema, { pageSize: 100, ...optional("pageToken", pageToken) }) }, { headers });
      assertSiteItems(response.items, input.siteId);
      return listJson(response.items.map(codeBatchJson), response.nextPageToken, response.observedAt);
    });
  },

  async getCodeBatch(siteId: string, id: string): Promise<AdminCodeBatch> {
    const { rpc, context, headers } = await queryRuntime(siteId, READ_SURFACE.codeBatches);
    return queryCall(async () => {
      const response = await rpc.getCodeBatch({ context, batchRef: id }, { headers });
      if (response.batch === undefined || response.batch.siteId !== siteId || response.batch.batchRef !== id) {
        throw invalidResponse();
      }
      return codeBatchJson(response.batch);
    });
  },

  async issueCodeBatch(raw: IssueCodeBatchInput) {
    const input = issueCodeBatchInputSchema.parse(raw);
    const { rpc, context, axes, headers } = await commandRuntime(input.siteId, "commerceCodeBatchesIssue");
    const effect = create(IssueCodeBatchEffectSchema, {
      batchRef: input.batchRef,
      redemptionProgramRevisionRef: input.redemptionProgramRevisionRef,
      count: input.count,
      ...optionalTimestamp("startsAt", input.startsAt),
      ...optionalTimestamp("endsAt", input.endsAt),
    });
    setDigest(context, issueCodeBatchRequestDigest(context, effect, axes));
    // A delivery-unknown Issue is never auto-replayed: replay cannot return the one-time secret export.
    const response = await commandCall(() => rpc.issueCodeBatch({ context, effect }, { headers }));
    validateReceipt(response.receipt, context, "commerce.code-batch.issue");
    const result = response.result;
    if (result === undefined || result.batchRef !== input.batchRef || result.codeCount !== input.count ||
        result.redemptionProgramRevisionRef !== input.redemptionProgramRevisionRef) throw invalidResponse();
    const disposition = dispositionJson(response.disposition);
    const delivery = response.delivery.case === "secretExport" && disposition === "committed" &&
        response.delivery.value.rawCodes.length === result.codeCount
      ? { kind: "secret_export" as const, rawCodes: [...response.delivery.value.rawCodes] }
      : response.delivery.case === "deliveryUnavailable" && disposition === "replayed" &&
          response.delivery.value.requiredAction === CodeBatchRecoveryAction.ABANDON_AND_REISSUE
        ? { kind: "delivery_unavailable" as const, requiredAction: "abandon_and_reissue" as const }
        : null;
    if (delivery === null) throw invalidResponse();
    return {
      batchRef: result.batchRef,
      codeCount: result.codeCount,
      redemptionProgramRevisionRef: result.redemptionProgramRevisionRef,
      createdByOperatorRef: result.createdByOperatorRef,
      startsAt: optionalInstant(result.startsAt),
      endsAt: optionalInstant(result.endsAt),
      exportedAt: requiredInstant(result.exportedAt),
      disposition,
      delivery,
      receipt: receiptJson(response.receipt),
    };
  },

  approveCodeBatch(siteId: string, batchRef: string) {
    return batchMutation(siteId, batchRef, "commerceCodeBatchesApprove", "commerce.code-batch.approve",
      ApproveCodeBatchEffectSchema, approveCodeBatchRequestDigest, "approveCodeBatch", CodeBatchState.DRAFT,
      CodeBatchApprovalState.APPROVED);
  },

  activateCodeBatch(siteId: string, batchRef: string) {
    return batchMutation(siteId, batchRef, "commerceCodeBatchesActivate", "commerce.code-batch.activate",
      ActivateCodeBatchEffectSchema, activateCodeBatchRequestDigest, "activateCodeBatch", CodeBatchState.ACTIVE,
      CodeBatchApprovalState.APPROVED);
  },

  abandonCodeBatch(siteId: string, batchRef: string, reason: string) {
    return batchMutation(siteId, batchRef, "commerceCodeBatchesAbandon", "commerce.code-batch.abandon",
      AbandonCodeBatchEffectSchema, abandonCodeBatchRequestDigest, "abandonCodeBatch", CodeBatchState.ABANDONED,
      null, reason);
  },

  suspendCodeBatch(siteId: string, batchRef: string, reason: string) {
    return batchMutation(siteId, batchRef, "commerceCodeBatchesSuspend", "commerce.code-batch.suspend",
      SuspendCodeBatchEffectSchema, suspendCodeBatchRequestDigest, "suspendCodeBatch", CodeBatchState.SUSPENDED,
      CodeBatchApprovalState.APPROVED, reason);
  },

  revokeCodeBatch(siteId: string, batchRef: string, reason: string) {
    return batchMutation(siteId, batchRef, "commerceCodeBatchesRevoke", "commerce.code-batch.revoke",
      RevokeCodeBatchEffectSchema, revokeCodeBatchRequestDigest, "revokeCodeBatch", CodeBatchState.REVOKED,
      CodeBatchApprovalState.APPROVED, reason);
  },
});

type BatchEffectSchema = typeof ApproveCodeBatchEffectSchema | typeof ActivateCodeBatchEffectSchema |
  typeof AbandonCodeBatchEffectSchema | typeof SuspendCodeBatchEffectSchema | typeof RevokeCodeBatchEffectSchema;
type BatchDigest = (context: ReturnType<typeof create<typeof CommerceSiteCommandContextSchema>>,
  effect: never, axes: VerifiedCommerceSiteAxes) => string;
type BatchMethod = "approveCodeBatch" | "activateCodeBatch" | "abandonCodeBatch" |
  "suspendCodeBatch" | "revokeCodeBatch";

async function batchMutation(
  siteId: string,
  batchRef: string,
  surface: AdminSurface,
  operation: string,
  schema: BatchEffectSchema,
  digest: BatchDigest,
  method: BatchMethod,
  expectedState: CodeBatchState,
  expectedApproval: CodeBatchApprovalState | null,
  reason?: string,
) {
  const { rpc, context, axes, headers } = await commandRuntime(siteId, surface);
  const effect = create(schema, { batchRef, ...(reason === undefined ? {} : { reason }) } as never);
  setDigest(context, digest(context, effect as never, axes));
  const invoke = rpc[method] as unknown as (
    request: Readonly<{ context: typeof context; effect: typeof effect }>,
    options: Readonly<{ headers: Headers }>,
  ) => Promise<Readonly<{
    receipt?: CommandReceiptV2;
    disposition: CommerceCommandDisposition;
    result?: CodeBatchMutationResult;
  }>>;
  const response = await commandCall(() => invoke({ context, effect }, { headers }));
  validateReceipt(response.receipt, context, operation);
  const result = response.result;
  if (result === undefined || result.batchRef !== batchRef || result.state !== expectedState ||
      (expectedApproval === null ? result.approvalState !== undefined : result.approvalState !== expectedApproval)) {
    throw invalidResponse();
  }
  return mutationJson(result, response.disposition, response.receipt);
}

function creditProgramJson(value: CreditProgramRevisionView): AdminCreditProgram {
  return {
    id: value.creditProgramRevisionRef,
    siteId: value.siteId,
    creditProgramRevisionRef: value.creditProgramRevisionRef,
    programRef: value.programRef,
    revision: value.revision.toString(),
    bucketClass: bucketClassJson(value.uxBucketClass),
    unit: value.unit,
    amount: value.amount,
    burnPriority: value.burnPriority,
    scopePolicy: scopePolicyJson(value.scopePolicy),
    liabilityMerchantAccountRef: value.liabilityMerchantAccountRef,
    windowKind: windowKindJson(value.windowKind),
    rolloverPolicy: rolloverPolicyJson(value.rolloverPolicy),
    calendarZone: value.calendarZone ?? null,
    windowAnchor: value.windowAnchor ?? null,
    expiresAfterSeconds: value.expiresAfterSeconds?.toString() ?? null,
    revisionDigest: value.revisionDigest,
    publishedAt: requiredInstant(value.publishedAt),
  };
}

function entitlementTemplateJson(value: EntitlementTemplateRevisionView): AdminEntitlementTemplate {
  return {
    id: value.entitlementTemplateRevisionRef,
    siteId: value.siteId,
    entitlementTemplateRevisionRef: value.entitlementTemplateRevisionRef,
    templateRef: value.templateRef,
    revision: value.revision.toString(),
    capabilityKey: value.capabilityKey,
    safeLabel: value.safeLabel,
    expiresAfterSeconds: value.expiresAfterSeconds?.toString() ?? null,
    revisionDigest: value.revisionDigest,
    publishedAt: requiredInstant(value.publishedAt),
  };
}

function offerJson(value: OfferRevisionView): AdminOffer {
  return {
    id: value.productVersionRef,
    siteId: value.siteId,
    productRef: value.productRef,
    productKind: productKindJson(value.productKind),
    productVersionRef: value.productVersionRef,
    revision: value.revision.toString(),
    safeLabel: value.safeLabel,
    planVersion: value.planVersion === undefined ? null : {
      planRef: value.planVersion.planRef,
      planVersionRef: value.planVersion.planVersionRef,
      revision: value.planVersion.revision.toString(),
      safeLabel: value.planVersion.safeLabel,
      termAction: termActionJson(value.planVersion.termAction),
      termSeconds: value.planVersion.termSeconds?.toString() ?? null,
      stackingScope: value.planVersion.stackingScope,
      revisionDigest: value.planVersion.revisionDigest,
    },
    fulfillmentProgramRevisionRef: value.fulfillmentProgramRevisionRef,
    outputs: value.outputs.map((item) => ({ outputLineId: item.outputLineId, ordinal: item.ordinal,
      cardinality: item.cardinality, outputKind: outputKindJson(item.outputKind),
      targetRevisionRef: item.targetRevisionRef })),
    legalTermRefs: [...value.legalTermRefs],
    publishedAt: requiredInstant(value.publishedAt),
  };
}

function redemptionProgramJson(value: RedemptionProgramRevisionView): AdminRedemptionProgram {
  return {
    id: value.redemptionProgramRevisionRef,
    siteId: value.siteId,
    redemptionProgramRevisionRef: value.redemptionProgramRevisionRef,
    programRef: value.programRef,
    revision: value.revision.toString(),
    productVersionRef: value.productVersionRef,
    fulfillmentProgramRevisionRef: value.fulfillmentProgramRevisionRef,
    maxRedemptionsPerAccount: value.maxRedemptionsPerAccount,
    availabilityState: redemptionStateJson(value.availabilityState),
    publishedAt: requiredInstant(value.publishedAt),
  };
}

function codeBatchJson(value: CodeBatchView): AdminCodeBatch {
  if (value.exportReceipt === undefined || value.exportReceipt.batchRef !== value.batchRef ||
      value.exportReceipt.codeCount !== value.inventoryCount ||
      value.exportReceipt.exportedToOperatorRef !== value.createdByOperatorRef) throw invalidResponse();
  return {
    id: value.batchRef,
    siteId: value.siteId,
    batchRef: value.batchRef,
    redemptionProgramRevisionRef: value.redemptionProgramRevisionRef,
    state: batchStateJson(value.state),
    approvalState: batchApprovalJson(value.approvalState),
    inventoryCount: value.inventoryCount,
    createdByOperatorRef: value.createdByOperatorRef,
    startsAt: optionalInstant(value.startsAt),
    endsAt: optionalInstant(value.endsAt),
    createdAt: requiredInstant(value.createdAt),
    activatedAt: optionalInstant(value.activatedAt),
    exportReceipt: {
      batchRef: value.exportReceipt.batchRef,
      exportCommandId: value.exportReceipt.exportCommandId,
      exportedToOperatorRef: value.exportReceipt.exportedToOperatorRef,
      codeCount: value.exportReceipt.codeCount,
      exportedAt: requiredInstant(value.exportReceipt.exportedAt),
    },
  };
}

function mutationJson(result: CodeBatchMutationResult, disposition: CommerceCommandDisposition,
  receipt: CommandReceiptV2 | undefined) {
  return {
    batchRef: result.batchRef,
    state: batchStateJson(result.state),
    approvalState: result.approvalState === undefined ? null : batchApprovalJson(result.approvalState),
    changedAt: requiredInstant(result.changedAt),
    disposition: dispositionJson(disposition),
    receipt: receiptJson(receipt),
  };
}

function publicationJson(id: string, publishedAt: TimestampLike | undefined, revisionDigest: string | null,
  disposition: CommerceCommandDisposition, receipt: CommandReceiptV2 | undefined) {
  return { id, disposition: dispositionJson(disposition), publishedAt: requiredInstant(publishedAt),
    revisionDigest, receipt: receiptJson(receipt) };
}

function listJson<Item>(items: readonly Item[], nextPageToken: string | undefined,
  observedAt: TimestampLike | undefined): CommerceList<Item> {
  return { items, nextPageToken: nextPageToken ?? null, observedAt: requiredInstant(observedAt) };
}

function assertSiteItems(items: readonly Readonly<{ siteId: string }>[], siteId: string): void {
  if (items.some((item) => item.siteId !== siteId)) throw invalidResponse();
}

function validateReceipt(receipt: CommandReceiptV2 | undefined,
  context: ReturnType<typeof create<typeof CommerceSiteCommandContextSchema>>, operation: string): void {
  const actual = receipt?.identity;
  const expected = context.operator?.command;
  if (receipt?.state !== CommandReceiptStateV2.COMMITTED || receipt.operation !== operation ||
      actual === undefined || expected === undefined || actual.commandId !== expected.commandId ||
      actual.digestAlgorithm !== CommandDigestAlgorithmV2.SHA256_COMMAND_ENVELOPE ||
      actual.requestDigest !== expected.requestDigest) throw invalidResponse();
}

function receiptJson(receipt: CommandReceiptV2 | undefined) {
  if (receipt?.identity === undefined) throw invalidResponse();
  return { commandId: receipt.identity.commandId, operation: receipt.operation, state: "committed" as const,
    recordedAt: requiredInstant(receipt.recordedAt) };
}

function setDigest(context: ReturnType<typeof create<typeof CommerceSiteCommandContextSchema>>, digest: string): void {
  if (context.operator?.command === undefined) throw invalidResponse();
  context.operator.command.requestDigest = digest;
}

function optionalCursor(value: string | undefined): string | undefined {
  return value === undefined ? undefined : commerceCursorSchema.parse(value);
}

function positiveBigInt(value: string): bigint {
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new AdminControlPlaneError(Code.InvalidArgument, "admin_commerce.invalid_input");
  return parsed;
}

function optional<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, Value>>;
}

function optionalTimestamp<Key extends string>(key: Key, value: string | undefined) {
  return value === undefined ? {} : { [key]: timestampFromDate(new Date(value)) } as Record<Key,
    ReturnType<typeof timestampFromDate>>;
}

type TimestampLike = Readonly<{ seconds: bigint; nanos: number }>;
function requiredInstant(value: TimestampLike | undefined): string {
  if (value === undefined) throw invalidResponse();
  return new Date(Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000)).toISOString();
}
function optionalInstant(value: TimestampLike | undefined): string | null {
  return value === undefined ? null : requiredInstant(value);
}

function scopePolicyJson(value: CreditProgramRevisionView["scopePolicy"]) {
  if (value === undefined || value.policyVersion !== 1) throw invalidResponse();
  return { policyVersion: 1 as const, surfaceRefs: [...value.surfaceRefs],
    capabilityKeys: [...value.capabilityKeys], agentRefs: [...value.agentRefs],
    allowUnattributedAgent: value.allowUnattributedAgent };
}

function dispositionJson(value: CommerceCommandDisposition) {
  return mapEnum(value, {
    [CommerceCommandDisposition.COMMITTED]: "committed",
    [CommerceCommandDisposition.REPLAYED]: "replayed",
  } as const);
}
function bucketClassJson(value: CreditProgramBucketClass) { return mapEnum(value, {
  [CreditProgramBucketClass.DAILY]: "daily", [CreditProgramBucketClass.PERIOD]: "period",
  [CreditProgramBucketClass.PERMANENT]: "permanent",
} as const); }
function bucketClassWire(value: PublishCreditProgramInput["bucketClass"]) { return reverseEnum(value, {
  daily: CreditProgramBucketClass.DAILY, period: CreditProgramBucketClass.PERIOD,
  permanent: CreditProgramBucketClass.PERMANENT,
}); }
function windowKindJson(value: CreditProgramWindowKind) { return mapEnum(value, {
  [CreditProgramWindowKind.NONE]: "none", [CreditProgramWindowKind.DAILY]: "daily",
  [CreditProgramWindowKind.PERIOD]: "period",
} as const); }
function rolloverPolicyJson(value: CreditProgramRolloverPolicy) { return mapEnum(value, {
  [CreditProgramRolloverPolicy.NONE]: "none",
} as const); }
function productKindJson(value: CommerceProductKind) { return mapEnum(value, {
  [CommerceProductKind.FREE]: "free", [CommerceProductKind.CREDIT_PACK]: "credit_pack",
  [CommerceProductKind.SUBSCRIPTION]: "subscription", [CommerceProductKind.BUNDLE]: "bundle",
} as const); }
function productKindWire(value: PublishOfferInput["productKind"]) { return reverseEnum(value, {
  free: CommerceProductKind.FREE, credit_pack: CommerceProductKind.CREDIT_PACK,
  subscription: CommerceProductKind.SUBSCRIPTION, bundle: CommerceProductKind.BUNDLE,
}); }
function termActionJson(value: CommercePlanTermAction) { return mapEnum(value, {
  [CommercePlanTermAction.NONE]: "none", [CommercePlanTermAction.NEW_SUBSCRIPTION]: "new_subscription",
  [CommercePlanTermAction.EXTEND_FROM_MAX]: "extend_from_max",
  [CommercePlanTermAction.REJECT_IF_ACTIVE]: "reject_if_active",
} as const); }
function termActionWire(value: NonNullable<PublishOfferInput["planVersion"]>["termAction"]) { return reverseEnum(value, {
  none: CommercePlanTermAction.NONE, new_subscription: CommercePlanTermAction.NEW_SUBSCRIPTION,
  extend_from_max: CommercePlanTermAction.EXTEND_FROM_MAX,
  reject_if_active: CommercePlanTermAction.REJECT_IF_ACTIVE,
}); }
function outputKindJson(value: CommerceFulfillmentOutputKind) { return mapEnum(value, {
  [CommerceFulfillmentOutputKind.SUBSCRIPTION_TERM]: "subscription_term",
  [CommerceFulfillmentOutputKind.ENTITLEMENT_GRANT]: "entitlement_grant",
  [CommerceFulfillmentOutputKind.CREDIT_GRANT]: "credit_grant",
  [CommerceFulfillmentOutputKind.CREDIT_PROGRAM_ENROLLMENT]: "credit_program_enrollment",
} as const); }
function outputKindWire(value: PublishOfferInput["outputs"][number]["outputKind"]) { return reverseEnum(value, {
  subscription_term: CommerceFulfillmentOutputKind.SUBSCRIPTION_TERM,
  entitlement_grant: CommerceFulfillmentOutputKind.ENTITLEMENT_GRANT,
  credit_grant: CommerceFulfillmentOutputKind.CREDIT_GRANT,
  credit_program_enrollment: CommerceFulfillmentOutputKind.CREDIT_PROGRAM_ENROLLMENT,
}); }
function redemptionStateJson(value: RedemptionProgramAvailabilityState) { return mapEnum(value, {
  [RedemptionProgramAvailabilityState.ACTIVE]: "active",
  [RedemptionProgramAvailabilityState.PAUSED]: "paused",
  [RedemptionProgramAvailabilityState.RETIRED]: "retired",
} as const); }
function batchStateJson(value: CodeBatchState) { return mapEnum(value, {
  [CodeBatchState.DRAFT]: "draft", [CodeBatchState.ACTIVE]: "active",
  [CodeBatchState.SUSPENDED]: "suspended", [CodeBatchState.ABANDONED]: "abandoned",
  [CodeBatchState.REVOKED]: "revoked",
} as const); }
function batchApprovalJson(value: CodeBatchApprovalState) { return mapEnum(value, {
  [CodeBatchApprovalState.PENDING]: "pending", [CodeBatchApprovalState.APPROVED]: "approved",
} as const); }

function mapEnum<const Result extends string>(value: number, mapping: Readonly<Record<number, Result>>): Result {
  const result = mapping[value];
  if (result === undefined) throw invalidResponse();
  return result;
}
function reverseEnum<Key extends string, Value extends number>(value: Key,
  mapping: Readonly<Record<Key, Value>>): Value {
  return mapping[value];
}

async function queryCall<Result>(invoke: () => Promise<Result>): Promise<Result> {
  try { return await invoke(); } catch (error) { throw typed(error); }
}

async function commandCall<Result>(invoke: () => Promise<Result>): Promise<Result> {
  try { return await invoke(); } catch (error) { throw typed(error); }
}

function typed(reason: unknown): AdminControlPlaneError {
  if (reason instanceof AdminControlPlaneError) return reason;
  const error = ConnectError.from(reason);
  const detail = error.findDetails(KokoroErrorDetailSchema)[0];
  return new AdminControlPlaneError(error.code, detail?.domainCode || "admin_commerce.unavailable",
    detail?.receiptRef || null);
}

function invalidResponse(): AdminControlPlaneError {
  return new AdminControlPlaneError(Code.Internal, "admin_commerce.invalid_response");
}
