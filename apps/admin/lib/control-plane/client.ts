import "server-only";

import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";

import { adminControlPlaneTransport } from "./transport";
import { requireAuthoritySession, type AdminAuthoritySession } from "./authority-session";
import { KokoroErrorDetailSchema } from "@/lib/generated/admin-commerce/kokoro/common/v1/error_pb";
import {
  CommandDigestAlgorithmV2, CommandIdentityV2Schema, CommandReceiptStateV2, OperatorAssuranceLevel,
} from "@/lib/generated/admin-commerce/kokoro/common/v2/command_envelope_pb";
import {
  AuthenticatedOperatorCommandContextSchema, AuthenticatedOperatorQueryContextSchema,
  GlobalScopeSchema, OperatorScopeSchema, SecurityEpochsSchema, SiteScopeSchema,
} from "@/lib/generated/admin-commerce/kokoro/platform/admin/v2/admin_shared_pb";
import { AdminQueryService, OperatorState } from
  "@/lib/generated/admin-query-v2/kokoro/platform/admin/v2/admin_query_pb";
import {
  AdminCommerceService, CodeBatchActionEffectSchema, CodeBatchApprovalState, CodeBatchState,
  CodeDeliveryState, FulfillmentOutputDraftSchema, FulfillmentOutputKind, IssueCodeBatchEffectSchema,
  PlanTermAction, PlanVersionDraftSchema, ProductKind, PublishOfferEffectSchema,
  PublishRedemptionProgramEffectSchema, type CodeBatchActionEffect, type CodeBatchMutationResult,
  type OfferSummary, type PublishOfferEffect, type PublishRedemptionProgramEffect,
} from "@/lib/generated/admin-commerce/kokoro/platform/commerce/v1/admin_commerce_pb";
import type { CommandReceiptV2 } from "@/lib/generated/admin-commerce/kokoro/common/v2/command_envelope_pb";
import {
  activateCodeBatchRequestDigest, approveCodeBatchRequestDigest, issueCodeBatchRequestDigest,
  publishOfferRequestDigest, publishRedemptionProgramRequestDigest, revokeCodeBatchRequestDigest,
  suspendCodeBatchRequestDigest,
  type VerifiedAuthenticatedAdminAxes,
} from "@/lib/generated/admin-commerce/command-envelope-digest";
import {
  ProvisionedSiteState, PublishedSiteReleaseState, PublishSiteReleaseEffectSchema,
  RegisterSiteEffectSchema, SiteLocalePolicySchema, SiteProvisioningService,
  SiteReleaseCertificationProofSchema,
} from "@/lib/generated/site-provisioning/kokoro/platform/site/v1/site_provisioning_pb";
import { publishSiteReleaseRequestDigest, registerSiteRequestDigest } from
  "@/lib/generated/site-provisioning/command-envelope-digest";

export class AdminControlPlaneError extends Error {
  constructor(readonly connectCode: Code, readonly domainCode: string, readonly receiptRef: string | null = null) {
    super("admin_control_plane_request_failed");
    this.name = "AdminControlPlaneError";
  }
}

export interface PublishOfferInput {
  readonly siteId: string; readonly productRef: string; readonly productVersionRef: string;
  readonly productKind: "credit_pack" | "subscription" | "bundle"; readonly revision: number;
  readonly safeLabel: string; readonly fulfillmentProgramRef: string;
  readonly fulfillmentProgramRevisionRef: string; readonly fulfillmentProgramRevision: number;
  readonly plan?: Readonly<{ planRef: string; planVersionRef: string; revision: number; safeLabel: string;
    termAction: "none" | "new_subscription" | "extend_from_max" | "reject_if_active";
    termSeconds?: number; stackingScope: string }>;
  readonly outputs: readonly Readonly<{ lineId: string; ordinal: number; cardinality: number;
    kind: "subscription_term" | "entitlement_grant" | "credit_grant"; targetRef: string }>[];
  readonly legalTermRefs: readonly string[];
}

export interface RegisterSiteInput {
  readonly siteId: string; readonly siteKey: string; readonly projectBindingRef: string;
  readonly repositoryRef: string; readonly providerNamespace: string; readonly providerProjectRef: string;
  readonly workloadIdentityRef: string;
}

export interface PublishSiteReleaseInput {
  readonly siteId: string; readonly releaseRef: string; readonly webArtifactDigest: string;
  readonly releaseManifestDigest: string; readonly certificationDigest: string; readonly launchProfileRef: string;
  readonly siteConfigRevisionRef: string; readonly legalRevisionRef: string; readonly featurePolicyRevision: string;
  readonly modelOptionCatalogRef: string; readonly agentCatalogRef: string; readonly identityIssuerLabel: string;
  readonly identityAuthStrengthPolicyRevision: string; readonly enabledSurfaceIds: readonly string[];
  readonly localePolicy: Readonly<{ defaultLocale: string; allowedLocales: readonly string[] }>;
  readonly certification: Readonly<{ signingKeyRef: string; issuedAt: string; expiresAt: string;
    signatureBase64: string }>;
}

export async function getCurrentOperator() {
  const { query, headers, context } = await queryCall();
  const response = await query.getCurrentOperator({ context }, { headers });
  if (response.operator === undefined) throw invalidResponse();
  return operatorJson(response.operator);
}

export async function listOperators(pageToken?: string) {
  const { query, headers, context } = await queryCall();
  const response = await query.listOperators({ context, pageSize: 100, ...(pageToken ? { pageToken } : {}) }, { headers });
  return { items: response.operators.map(operatorJson), nextPageToken: response.nextPageToken ?? null };
}

export async function listPendingApprovals(siteId?: string, pageToken?: string) {
  const { query, headers, context } = await queryCall();
  const response = await query.listPendingApprovals({ context, pageSize: 100,
    ...(siteId ? { siteId } : {}), ...(pageToken ? { pageToken } : {}) }, { headers });
  return { items: response.approvals.map((item) => ({ approvalRef: item.approvalRef, operation: item.operation,
    makerRef: item.makerRef, targetSiteRef: item.targetSiteRef ?? null, environment: item.environment,
    region: item.region, operatorReason: item.operatorReason,
    admittedAt: requiredInstant(item.admittedAt), expiresAt: requiredInstant(item.expiresAt) })),
    nextPageToken: response.nextPageToken ?? null };
}

export async function listSites(pageToken?: string) {
  const { query, headers, context } = await queryCall();
  const response = await query.listSites({ context, pageSize: 100,
    ...(pageToken ? { pageToken } : {}) }, { headers });
  return { items: response.sites.map(siteJson), nextPageToken: response.nextPageToken ?? null };
}

export async function getSite(siteId: string) {
  const { query, headers, context } = await queryCall();
  const response = await query.getSite({ context, siteId }, { headers });
  if (response.site === undefined) throw invalidResponse();
  return siteJson(response.site);
}

export async function getAuditWithinScope(siteId?: string, pageToken?: string) {
  const selection: ScopeSelection = siteId ? { kind: "site", siteId } : { kind: "current" };
  const { query, headers, context } = await queryCall(selection);
  const response = await query.getAuditWithinScope({ context, pageSize: 100,
    ...(pageToken ? { pageToken } : {}) }, { headers });
  return { items: response.records.map((item) => ({ auditRef: item.auditRef, actionCode: item.actionCode,
    occurredAt: requiredInstant(item.occurredAt) })), nextPageToken: response.nextPageToken ?? null };
}

export async function listOffers(siteId: string, pageToken?: string) {
  const { commerce, headers, context } = await queryCall();
  const response = await commerce.listOffers({ context, siteId, pageSize: 100,
    ...(pageToken ? { pageToken } : {}) }, { headers });
  return { items: response.offers.map((item) => ({ siteId: item.siteId, productRef: item.productRef,
    productVersionRef: item.productVersionRef, revision: item.revision.toString(), safeLabel: item.safeLabel,
    planVersionRef: item.planVersionRef ?? null, fulfillmentProgramRevisionRef: item.fulfillmentProgramRevisionRef,
    publishedAt: requiredInstant(item.publishedAt) })), nextPageToken: response.nextPageToken ?? null };
}

export async function publishOffer(input: PublishOfferInput) {
  const effect = create(PublishOfferEffectSchema, {
    productRef: input.productRef, productVersionRef: input.productVersionRef,
    productKind: productKind(input.productKind), productRevision: BigInt(input.revision), safeLabel: input.safeLabel,
    fulfillmentProgramRef: input.fulfillmentProgramRef,
    fulfillmentProgramRevisionRef: input.fulfillmentProgramRevisionRef,
    fulfillmentProgramRevision: BigInt(input.fulfillmentProgramRevision), legalTermRefs: [...input.legalTermRefs],
    ...(input.plan ? { planVersion: create(PlanVersionDraftSchema, { planRef: input.plan.planRef,
      planVersionRef: input.plan.planVersionRef, revision: BigInt(input.plan.revision), safeLabel: input.plan.safeLabel,
      termAction: planTermAction(input.plan.termAction), ...(input.plan.termSeconds ? { termSeconds: BigInt(input.plan.termSeconds) } : {}),
      stackingScope: input.plan.stackingScope }) } : {}),
    outputs: input.outputs.map((output) => create(FulfillmentOutputDraftSchema, { outputLineId: output.lineId,
      ordinal: output.ordinal, cardinality: output.cardinality, outputKind: outputKind(output.kind),
      target: output.kind === "subscription_term" ? { case: "planVersionRef", value: output.targetRef } :
        output.kind === "entitlement_grant" ? { case: "entitlementTemplateRevisionRef", value: output.targetRef } :
          { case: "creditProgramRevisionRef", value: output.targetRef } })),
  });
  return mutation(input.siteId, effect, publishOfferRequestDigest,
    (rpc, request, headers) => rpc.publishOffer(request, { headers }), (response) => ({
      productVersionRef: response.offer?.productVersionRef ?? input.productVersionRef,
      receipt: receiptJson(response.receipt),
    }));
}

export async function listRedemptionPrograms(siteId: string, pageToken?: string) {
  const { commerce, headers, context } = await queryCall();
  const response = await commerce.listRedemptionPrograms({ context, siteId, pageSize: 100,
    ...(pageToken ? { pageToken } : {}) }, { headers });
  return { items: response.programs.map((item) => ({
    redemptionProgramRevisionRef: item.redemptionProgramRevisionRef, programRef: item.programRef,
    revision: item.revision.toString(), productVersionRef: item.productVersionRef,
    fulfillmentProgramRevisionRef: item.fulfillmentProgramRevisionRef,
    maxRedemptionsPerAccount: item.maxRedemptionsPerAccount, availabilityState: item.availabilityState,
    publishedAt: requiredInstant(item.publishedAt),
  })), nextPageToken: response.nextPageToken ?? null };
}

export async function publishRedemptionProgram(input: Readonly<{ siteId: string;
  redemptionProgramRevisionRef: string; programRef: string; revision: number; productVersionRef: string;
  fulfillmentProgramRevisionRef: string; maxRedemptionsPerAccount: number }>) {
  const effect = create(PublishRedemptionProgramEffectSchema, {
    redemptionProgramRevisionRef: input.redemptionProgramRevisionRef, programRef: input.programRef,
    revision: BigInt(input.revision), productVersionRef: input.productVersionRef,
    fulfillmentProgramRevisionRef: input.fulfillmentProgramRevisionRef,
    maxRedemptionsPerAccount: input.maxRedemptionsPerAccount,
  });
  return mutation(input.siteId, effect, publishRedemptionProgramRequestDigest,
    (rpc, request, headers) => rpc.publishRedemptionProgram(request, { headers }),
    (response) => ({ redemptionProgramRevisionRef: response.program?.redemptionProgramRevisionRef ??
      input.redemptionProgramRevisionRef, receipt: receiptJson(response.receipt) }));
}

export async function issueCodeBatch(input: Readonly<{ siteId: string; batchRef: string;
  redemptionProgramRevisionRef: string; count: number; startsAt?: string; endsAt?: string }>) {
  const session = await requireAuthoritySession();
  const transport = await adminControlPlaneTransport();
  const rpc = createClient(AdminCommerceService, transport);
  const effect = create(IssueCodeBatchEffectSchema, { batchRef: input.batchRef,
    redemptionProgramRevisionRef: input.redemptionProgramRevisionRef, count: input.count,
    ...(input.startsAt ? { startsAt: timestampFromDate(new Date(input.startsAt)) } : {}),
    ...(input.endsAt ? { endsAt: timestampFromDate(new Date(input.endsAt)) } : {}) });
  const context = commandContext(session);
  const identity = context.command!;
  identity.requestDigest = issueCodeBatchRequestDigest(context, input.siteId, effect, verifiedAxes(session));
  try {
    const response = await rpc.issueCodeBatch({ context, siteId: input.siteId, effect }, { headers: authHeaders(session) });
    assertReceipt(response.receipt, context);
    if (response.deliveryState !== CodeDeliveryState.SECRET_EXPORT || response.rawCodes.length !== input.count) {
      throw new AdminControlPlaneError(Code.FailedPrecondition, "commerce.code_batch.delivery_unavailable",
        identity.commandId);
    }
    return { batchRef: input.batchRef, rawCodes: [...response.rawCodes], receipt: receiptJson(response.receipt) };
  } catch (error) {
    const connect = ConnectError.from(error);
    if ([Code.DeadlineExceeded, Code.Unavailable].includes(connect.code)) {
      throw new AdminControlPlaneError(connect.code, "commerce.code_batch.delivery_outcome_unknown", identity.commandId);
    }
    throw typed(error);
  }
}

export async function listCodeBatches(siteId: string, pageToken?: string) {
  const { commerce, headers, context } = await queryCall();
  const response = await commerce.listCodeBatches({ context, siteId, pageSize: 100,
    ...(pageToken ? { pageToken } : {}) }, { headers });
  return { items: response.batches.map((item) => ({ batchRef: item.batchRef,
    redemptionProgramRevisionRef: item.redemptionProgramRevisionRef, state: codeState(item.state),
    approvalState: approvalState(item.approvalState), inventoryCount: item.inventoryCount,
    createdByOperatorRef: item.createdByOperatorRef, createdAt: requiredInstant(item.createdAt),
    activatedAt: item.activatedAt ? requiredInstant(item.activatedAt) : null })), nextPageToken: response.nextPageToken ?? null };
}

export async function codeBatchAction(action: "approve" | "activate" | "suspend" | "revoke",
  input: Readonly<{ siteId: string; batchRef: string; reason: string }>) {
  const effect = create(CodeBatchActionEffectSchema, { batchRef: input.batchRef, reason: input.reason });
  const definitions = {
    approve: ["ApproveCodeBatch", approveCodeBatchRequestDigest, "approveCodeBatch"],
    activate: ["ActivateCodeBatch", activateCodeBatchRequestDigest, "activateCodeBatch"],
    suspend: ["SuspendCodeBatch", suspendCodeBatchRequestDigest, "suspendCodeBatch"],
    revoke: ["RevokeCodeBatch", revokeCodeBatchRequestDigest, "revokeCodeBatch"],
  } as const;
  const [, digest, rpcMethod] = definitions[action];
  return mutation(input.siteId, effect, digest,
    (rpc, request, headers) => rpc[rpcMethod](request, { headers }),
    (response) => ({ batchRef: response.result?.batchRef ?? input.batchRef, receipt: receiptJson(response.receipt) }));
}

export async function registerSite(input: RegisterSiteInput) {
  const session = await requireAuthoritySession();
  const rpc = createClient(SiteProvisioningService, await adminControlPlaneTransport());
  const effect = create(RegisterSiteEffectSchema, { siteKey: input.siteKey,
    projectBindingRef: input.projectBindingRef, repositoryRef: input.repositoryRef,
    providerNamespace: input.providerNamespace, providerProjectRef: input.providerProjectRef,
    workloadIdentityRef: input.workloadIdentityRef });
  const context = commandContext(session, { kind: "global" });
  context.command!.requestDigest = registerSiteRequestDigest(context, input.siteId, effect, verifiedAxes(session));
  return committedMutation(context, () => rpc.registerSite({ context, siteId: input.siteId, effect },
    { headers: authHeaders(session) }), (response) => {
    if (response.state !== ProvisionedSiteState.PREVIEW_READY || response.siteId !== input.siteId) {
      throw invalidResponse();
    }
    return { siteId: response.siteId, state: "preview_ready" as const, replayed: response.replayed,
      receipt: receiptJson(response.receipt) };
  });
}

export async function publishSiteRelease(input: PublishSiteReleaseInput) {
  const session = await requireAuthoritySession();
  const rpc = createClient(SiteProvisioningService, await adminControlPlaneTransport());
  const signature = canonicalSignature(input.certification.signatureBase64);
  const effect = create(PublishSiteReleaseEffectSchema, {
    releaseRef: input.releaseRef, webArtifactDigest: input.webArtifactDigest,
    releaseManifestDigest: input.releaseManifestDigest, certificationDigest: input.certificationDigest,
    launchProfileRef: input.launchProfileRef, siteConfigRevisionRef: input.siteConfigRevisionRef,
    legalRevisionRef: input.legalRevisionRef, featurePolicyRevision: input.featurePolicyRevision,
    modelOptionCatalogRef: input.modelOptionCatalogRef, agentCatalogRef: input.agentCatalogRef,
    identityIssuerLabel: input.identityIssuerLabel,
    identityAuthStrengthPolicyRevision: input.identityAuthStrengthPolicyRevision,
    enabledSurfaceIds: [...input.enabledSurfaceIds],
    localePolicy: create(SiteLocalePolicySchema, { defaultLocale: input.localePolicy.defaultLocale,
      allowedLocales: [...input.localePolicy.allowedLocales] }),
    certification: create(SiteReleaseCertificationProofSchema, {
      signingKeyRef: input.certification.signingKeyRef,
      issuedAt: timestampFromDate(new Date(input.certification.issuedAt)),
      expiresAt: timestampFromDate(new Date(input.certification.expiresAt)), signature,
    }),
  });
  const context = commandContext(session, { kind: "site", siteId: input.siteId });
  context.command!.requestDigest = publishSiteReleaseRequestDigest(context, input.siteId, effect, verifiedAxes(session));
  return committedMutation(context, () => rpc.publishSiteRelease({ context, siteId: input.siteId, effect },
    { headers: authHeaders(session) }), (response) => {
    if (response.state !== PublishedSiteReleaseState.READY || response.siteId !== input.siteId ||
        response.releaseRef !== input.releaseRef) throw invalidResponse();
    return { siteId: response.siteId, releaseRef: response.releaseRef, state: "ready" as const,
      replayed: response.replayed, receipt: receiptJson(response.receipt) };
  });
}

export type ScopeSelection = Readonly<{ kind: "current" }> | Readonly<{ kind: "global" }> |
  Readonly<{ kind: "site"; siteId: string }>;

async function queryCall(selection: ScopeSelection = { kind: "current" }) {
  const session = await requireAuthoritySession();
  const transport = await adminControlPlaneTransport();
  return { query: createClient(AdminQueryService, transport), commerce: createClient(AdminCommerceService, transport),
    headers: authHeaders(session), context: queryContext(session, selection) };
}

async function mutation<Effect extends PublishOfferEffect | PublishRedemptionProgramEffect | CodeBatchActionEffect, Result>(siteId: string,
  effect: Effect, digest: (context: ReturnType<typeof commandContext>, siteId: string, effect: Effect,
    axes: VerifiedAuthenticatedAdminAxes) => string,
  invoke: (rpc: ReturnType<typeof createClient<typeof AdminCommerceService>>, request: { context: ReturnType<typeof commandContext>;
    siteId: string; effect: Effect }, headers: Headers) => Promise<CommerceMutationResponse>,
  map: (response: CommerceMutationResponse) => Result): Promise<Result> {
  const session = await requireAuthoritySession();
  const rpc = createClient(AdminCommerceService, await adminControlPlaneTransport());
  const context = commandContext(session);
  context.command!.requestDigest = digest(context, siteId, effect, verifiedAxes(session));
  const request = { context, siteId, effect };
  try {
    let response: CommerceMutationResponse;
    try { response = await invoke(rpc, request, authHeaders(session)); }
    catch (error) {
      const code = ConnectError.from(error).code;
      if (![Code.DeadlineExceeded, Code.Unavailable].includes(code)) throw error;
      response = await invoke(rpc, request, authHeaders(session));
    }
    assertReceipt(response.receipt, context);
    return map(response);
  } catch (error) { throw typed(error); }
}

async function committedMutation<Response extends Readonly<{ receipt?: CommandReceiptV2 }>, Result>(
  context: ReturnType<typeof commandContext>, invoke: () => Promise<Response>, map: (response: Response) => Result,
): Promise<Result> {
  try {
    let response: Response;
    try { response = await invoke(); }
    catch (error) {
      const code = ConnectError.from(error).code;
      if (![Code.DeadlineExceeded, Code.Unavailable].includes(code)) throw error;
      response = await invoke();
    }
    assertReceipt(response.receipt, context);
    return map(response);
  } catch (error) { throw typed(error); }
}

export function queryContext(session: AdminAuthoritySession, selection: ScopeSelection = { kind: "current" }) {
  return create(AuthenticatedOperatorQueryContextSchema, { requestId: randomUUID(), ...sessionClaims(session),
    securityEpochs: epochs(session), scope: scope(session, selection) });
}
export function commandContext(session: AdminAuthoritySession, selection: ScopeSelection = { kind: "current" }) {
  const commandId = randomUUID();
  return create(AuthenticatedOperatorCommandContextSchema, { command: create(CommandIdentityV2Schema, {
    commandId, idempotencyKey: commandId, digestAlgorithm: CommandDigestAlgorithmV2.SHA256_COMMAND_ENVELOPE,
    requestDigest: "0".repeat(64) }), ...sessionClaims(session), securityEpochs: epochs(session),
    scope: scope(session, selection) });
}
function sessionClaims(session: AdminAuthoritySession) {
  return { operatorSessionRef: session.operatorSessionRef, environment: session.environment, region: session.region,
    managedDeviceRef: session.managedDeviceRef, actorRef: session.operatorRef,
    operatorGeneration: BigInt(session.operatorGeneration), assuranceLevel: assurance(session.assuranceLevel),
    factorClasses: [...session.factorClasses], authenticatedAt: timestampFromDate(new Date(session.authenticatedAt)),
    ...(session.stepUpAt ? { stepUpAt: timestampFromDate(new Date(session.stepUpAt)) } : {}),
    operatorAttestationRef: session.operatorAttestationRef, operatorAttestationDigest: session.operatorAttestationDigest };
}
function epochs(session: AdminAuthoritySession) {
  return create(SecurityEpochsSchema, { operatorSecurityEpoch: BigInt(session.operatorSecurityEpoch),
    sessionEpoch: BigInt(session.sessionEpoch), restrictionEpoch: BigInt(session.restrictionEpoch),
    policyEpoch: BigInt(session.policyEpoch) });
}
function scope(session: AdminAuthoritySession, selection: ScopeSelection) {
  if (selection.kind === "global") {
    const retained = session.globalScope ?? (session.scope.kind === "global" ? session.scope : null);
    if (retained === null) throw new AdminControlPlaneError(Code.PermissionDenied, "admin.authority.global_scope_required");
    return create(OperatorScopeSchema, { kind: { case: "global", value: create(GlobalScopeSchema, {
      grantId: retained.grantId, environment: retained.environment, region: retained.region }) } });
  }
  if (selection.kind === "site") {
    if (session.scope.kind !== "site" || !session.scope.siteIds.includes(selection.siteId)) {
      throw new AdminControlPlaneError(Code.PermissionDenied, "admin.authority.site_scope_required");
    }
    return create(OperatorScopeSchema, { kind: { case: "site", value: create(SiteScopeSchema,
      { siteIds: [selection.siteId], environment: session.scope.environment, region: session.scope.region }) } });
  }
  return create(OperatorScopeSchema, { kind: session.scope.kind === "site" ? { case: "site", value: create(SiteScopeSchema,
    { siteIds: session.scope.siteIds, environment: session.scope.environment, region: session.scope.region }) } :
    { case: "global", value: create(GlobalScopeSchema, { grantId: session.scope.grantId,
      environment: session.scope.environment, region: session.scope.region }) } });
}
export function verifiedAxes(session: AdminAuthoritySession): VerifiedAuthenticatedAdminAxes {
  return { workloadIdentityRef: session.workloadIdentityRef, audience: session.audience,
    actorRef: session.operatorRef, operatorSessionRef: session.operatorSessionRef, environment: session.environment,
    region: session.region, managedDeviceRef: session.managedDeviceRef, operatorGeneration: BigInt(session.operatorGeneration),
    assuranceLevel: assurance(session.assuranceLevel), factorClasses: session.factorClasses,
    authenticatedAt: timestampFromDate(new Date(session.authenticatedAt)),
    ...(session.stepUpAt ? { stepUpAt: timestampFromDate(new Date(session.stepUpAt)) } : {}),
    operatorAttestationRef: session.operatorAttestationRef, operatorAttestationDigest: session.operatorAttestationDigest };
}
export function authHeaders(session: AdminAuthoritySession): Headers { return new Headers({ authorization: `Bearer ${session.credential}` }); }
function assertReceipt(receipt: Readonly<{ state: CommandReceiptStateV2; identity?: Readonly<{ commandId: string;
  requestDigest: string }> }> | undefined, context: ReturnType<typeof commandContext>): void {
  const identity = receipt?.identity;
  const expected = context.command;
  if (receipt?.state !== CommandReceiptStateV2.COMMITTED || identity === undefined || expected === undefined ||
      identity.commandId !== expected.commandId || identity.requestDigest !== expected.requestDigest) throw invalidResponse();
}
function receiptJson(receipt: Readonly<{ identity?: Readonly<{ commandId: string }>; operation: string; state: CommandReceiptStateV2;
  recordedAt?: Readonly<{ seconds: bigint; nanos: number }> }> | undefined) {
  if (receipt === undefined) throw invalidResponse();
  return { commandId: receipt.identity?.commandId ?? "", operation: receipt.operation,
    state: receipt.state === CommandReceiptStateV2.COMMITTED ? "committed" : "invalid",
    recordedAt: requiredInstant(receipt.recordedAt) };
}
function typed(reason: unknown): AdminControlPlaneError {
  if (reason instanceof AdminControlPlaneError) return reason;
  const error = ConnectError.from(reason); const detail = error.findDetails(KokoroErrorDetailSchema)[0];
  return new AdminControlPlaneError(error.code, detail?.domainCode || "admin_control_plane.unavailable",
    detail?.receiptRef || null);
}
function invalidResponse() { return new AdminControlPlaneError(Code.Internal, "admin_control_plane.invalid_response"); }
function requiredInstant(value: Readonly<{ seconds: bigint; nanos: number }> | undefined): string {
  if (value === undefined) throw invalidResponse();
  return new Date(Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000)).toISOString();
}
function operatorJson(value: { operatorRef: string; operatorGeneration: bigint; state: OperatorState;
  effectivePermissions: string[]; effectiveSiteScopes: { siteId: string; environment: string; region: string;
    scopeEpoch: bigint; expiresAt?: Readonly<{ seconds: bigint; nanos: number }> }[]; operatorSecurityEpoch: bigint;
  authorizationEpoch: bigint; expiresAt?: Readonly<{ seconds: bigint; nanos: number }> }) {
  return { operatorRef: value.operatorRef, operatorGeneration: value.operatorGeneration.toString(),
    state: value.state === OperatorState.ACTIVE ? "active" : value.state === OperatorState.SUSPENDED ? "suspended" : "revoked",
    effectivePermissions: [...value.effectivePermissions], effectiveSiteScopes: value.effectiveSiteScopes.map((item) => ({
      siteId: item.siteId, environment: item.environment, region: item.region, scopeEpoch: item.scopeEpoch.toString(),
      expiresAt: requiredInstant(item.expiresAt) })), operatorSecurityEpoch: value.operatorSecurityEpoch.toString(),
    authorizationEpoch: value.authorizationEpoch.toString(), expiresAt: requiredInstant(value.expiresAt) };
}
function assurance(value: AdminAuthoritySession["assuranceLevel"]): OperatorAssuranceLevel {
  return value === "password" ? OperatorAssuranceLevel.PASSWORD : value === "mfa" ? OperatorAssuranceLevel.MFA : OperatorAssuranceLevel.PHISHING_RESISTANT;
}
function productKind(value: PublishOfferInput["productKind"]): ProductKind { return value === "credit_pack" ? ProductKind.CREDIT_PACK : value === "subscription" ? ProductKind.SUBSCRIPTION : ProductKind.BUNDLE; }
function planTermAction(value: NonNullable<PublishOfferInput["plan"]>["termAction"]): PlanTermAction { return value === "none" ? PlanTermAction.NONE : value === "new_subscription" ? PlanTermAction.NEW_SUBSCRIPTION : value === "extend_from_max" ? PlanTermAction.EXTEND_FROM_MAX : PlanTermAction.REJECT_IF_ACTIVE; }
function outputKind(value: PublishOfferInput["outputs"][number]["kind"]): FulfillmentOutputKind { return value === "subscription_term" ? FulfillmentOutputKind.SUBSCRIPTION_TERM : value === "entitlement_grant" ? FulfillmentOutputKind.ENTITLEMENT_GRANT : FulfillmentOutputKind.CREDIT_GRANT; }
function codeState(value: CodeBatchState): string { return CodeBatchState[value]?.toLowerCase() ?? "unknown"; }
function approvalState(value: CodeBatchApprovalState): string { return CodeBatchApprovalState[value]?.toLowerCase() ?? "unknown"; }
function siteJson(value: Readonly<{ siteRef: string; status: string; securityEpoch: bigint }>) {
  return { siteRef: value.siteRef, status: value.status, securityEpoch: value.securityEpoch.toString() };
}
function canonicalSignature(value: string): Uint8Array {
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength < 64 || decoded.byteLength > 512 || decoded.toString("base64") !== value) {
    throw new AdminControlPlaneError(Code.InvalidArgument, "site.release.certification_signature_invalid");
  }
  return decoded;
}

interface CommerceMutationResponse {
  readonly receipt?: CommandReceiptV2;
  readonly offer?: OfferSummary;
  readonly program?: Readonly<{ redemptionProgramRevisionRef: string }>;
  readonly result?: CodeBatchMutationResult;
}
