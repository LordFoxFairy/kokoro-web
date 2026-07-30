import "server-only";

import type { Client } from "@connectrpc/connect";
import { Code, ConnectError, createClient } from "@connectrpc/connect";

import { requireAuthoritySession } from "./authority-session";
import { AdminControlPlaneError, authHeaders, queryContext } from "./client";
import { adminControlPlaneTransport } from "./transport";
import { KokoroErrorDetailSchema } from "@/lib/generated/admin-credit/kokoro/common/v1/error_pb";
import {
  AdminCreditService,
  CreditAccountState,
  CreditBucketClass,
  CreditGrantSourceType,
  CreditHoldResolutionKind,
  CreditHoldState,
  CreditJournalAccountType,
  CreditJournalEntrySide,
  CreditJournalOperationKind,
  CreditReadFreshness,
  CreditUsageSourceDirection,
  type CreditAccountSummary,
  type CreditBalanceSummary,
  type CreditGrantSummary,
  type CreditHoldAllocationSummary,
  type CreditHoldSummary,
  type CreditJournalEntrySummary,
  type CreditJournalTransactionSummary,
  type RatedUsageSourceAllocationSummary,
  type RatedUsageSummary,
  type SiteCreditSummary,
} from "@/lib/generated/admin-credit/kokoro/platform/credit/v1/admin_credit_pb";
import type { CreditSourceType } from "@/lib/credit-contract";

type CreditRpc = Client<typeof AdminCreditService>;
type CreditRuntime = Readonly<{ rpc: CreditRpc; context: Parameters<CreditRpc["getSiteCreditSummary"]>[0]["context"];
  headers: Headers }>;
type RuntimeResolver = (siteId: string) => Promise<CreditRuntime>;

interface PageInput { readonly siteId: string; readonly pageToken?: string }
interface SourceFilter { readonly sourceType?: CreditSourceType; readonly sourceRef?: string }
export interface CreditGrantListInput extends PageInput, SourceFilter {
  readonly creditAccountRef?: string; readonly creditGrantId?: string; readonly executionRootRef?: string;
}
export interface CreditHoldListInput extends PageInput, SourceFilter {
  readonly creditAccountRef?: string; readonly creditGrantId?: string; readonly executionRootRef?: string;
}
export interface CreditJournalTransactionListInput extends PageInput, SourceFilter {
  readonly creditAccountRef?: string; readonly creditGrantId?: string; readonly creditHoldRef?: string;
  readonly executionRootRef?: string;
}
export interface RatedUsageListInput extends PageInput, SourceFilter {
  readonly creditAccountRef?: string; readonly creditGrantId?: string; readonly creditHoldRef?: string;
  readonly executionRootRef?: string; readonly attemptRef?: string;
}
export type HoldAllocationTrace = Readonly<{ kind: "hold" | "grant"; ref: string }>;
export type RatedUsageAllocationTrace = Readonly<{ kind: "usage" | "settlement"; ref: string }>;

export class AdminCreditInvalidResponseError extends AdminControlPlaneError {
  constructor() {
    super(Code.Internal, "admin_credit.invalid_response");
    this.name = "AdminCreditInvalidResponseError";
  }
}

export function createAdminCreditReader(runtime: RuntimeResolver) {
  return Object.freeze({
    async getSiteCreditSummary(siteId: string) {
      const { rpc, context, headers } = await runtime(siteId);
      const response = await call(() => rpc.getSiteCreditSummary({ context, siteId }, { headers }));
      if (response.summary === undefined) throw invalidResponse();
      assertEqual(response.summary.siteId, siteId);
      return siteSummaryJson(response.summary);
    },
    async listCreditAccounts(input: PageInput & Readonly<{ billingAccountRef?: string }>) {
      const { rpc, context, headers } = await runtime(input.siteId);
      const response = await call(() => rpc.listCreditAccounts({ context, siteId: input.siteId, pageSize: 100,
        ...optional("billingAccountRef", input.billingAccountRef), ...optional("pageToken", input.pageToken) }, { headers }));
      assertItems(response.accounts, input.siteId, (item) => assertOptional(item.billingAccountRef,
        input.billingAccountRef));
      return listJson(response, response.accounts.map(accountJson));
    },
    async getCreditAccount(siteId: string, creditAccountRef: string) {
      const { rpc, context, headers } = await runtime(siteId);
      const response = await call(() => rpc.getCreditAccount({ context, siteId, creditAccountRef }, { headers }));
      if (response.account === undefined) throw invalidResponse();
      assertEqual(response.account.siteId, siteId);
      assertEqual(response.account.creditAccountRef, creditAccountRef);
      return accountJson(response.account);
    },
    async listCreditGrants(input: CreditGrantListInput) {
      const { rpc, context, headers } = await runtime(input.siteId);
      const response = await call(() => rpc.listCreditGrants({ context, siteId: input.siteId, pageSize: 100,
        ...optional("creditAccountRef", input.creditAccountRef), ...optional("creditGrantId", input.creditGrantId),
        ...sourceInput(input), ...optional("executionRootRef", input.executionRootRef),
        ...optional("pageToken", input.pageToken) }, { headers }));
      assertItems(response.grants, input.siteId, (item) => {
        assertOptional(item.creditAccountRef, input.creditAccountRef);
        assertOptional(item.creditGrantId, input.creditGrantId);
        if (input.sourceType !== undefined) assertEqual(sourceType(item.sourceType), input.sourceType);
        assertOptional(item.sourceRef, input.sourceRef);
      });
      return listJson(response, response.grants.map(grantJson));
    },
    async listCreditHolds(input: CreditHoldListInput) {
      const { rpc, context, headers } = await runtime(input.siteId);
      const response = await call(() => rpc.listCreditHolds({ context, siteId: input.siteId, pageSize: 100,
        ...optional("creditAccountRef", input.creditAccountRef), ...optional("creditGrantId", input.creditGrantId),
        ...sourceInput(input), ...optional("executionRootRef", input.executionRootRef),
        ...optional("pageToken", input.pageToken) }, { headers }));
      assertItems(response.holds, input.siteId, (item) => {
        assertOptional(item.creditAccountRef, input.creditAccountRef);
        assertOptional(item.executionRootRef, input.executionRootRef);
      });
      return listJson(response, response.holds.map(holdJson));
    },
    async listCreditHoldAllocations(input: PageInput & Readonly<{ trace: HoldAllocationTrace }>) {
      const { rpc, context, headers } = await runtime(input.siteId);
      const trace = input.trace.kind === "hold" ? { case: "creditHoldRef" as const, value: input.trace.ref } :
        { case: "creditGrantId" as const, value: input.trace.ref };
      const response = await call(() => rpc.listCreditHoldAllocations({ context, siteId: input.siteId, trace,
        pageSize: 100, ...optional("pageToken", input.pageToken) }, { headers }));
      assertItems(response.allocations, input.siteId, (item) => assertEqual(
        input.trace.kind === "hold" ? item.creditHoldRef : item.creditGrantId, input.trace.ref));
      return listJson(response, response.allocations.map(holdAllocationJson));
    },
    async listCreditJournalTransactions(input: CreditJournalTransactionListInput) {
      const { rpc, context, headers } = await runtime(input.siteId);
      const response = await call(() => rpc.listCreditJournalTransactions({ context, siteId: input.siteId,
        pageSize: 100, ...optional("creditAccountRef", input.creditAccountRef),
        ...optional("creditGrantId", input.creditGrantId), ...optional("creditHoldRef", input.creditHoldRef),
        ...sourceInput(input), ...optional("executionRootRef", input.executionRootRef),
        ...optional("pageToken", input.pageToken) }, { headers }));
      assertItems(response.transactions, input.siteId, (item) => assertOptional(item.creditAccountRef,
        input.creditAccountRef));
      return listJson(response, response.transactions.map(journalTransactionJson));
    },
    async listCreditJournalEntries(input: PageInput & Readonly<{ journalTransactionRef: string }>) {
      const { rpc, context, headers } = await runtime(input.siteId);
      const response = await call(() => rpc.listCreditJournalEntries({ context, siteId: input.siteId,
        journalTransactionRef: input.journalTransactionRef, pageSize: 100,
        ...optional("pageToken", input.pageToken) }, { headers }));
      assertItems(response.entries, input.siteId, (item) => assertEqual(item.journalTransactionRef,
        input.journalTransactionRef));
      return listJson(response, response.entries.map(journalEntryJson));
    },
    async listRatedUsage(input: RatedUsageListInput) {
      const { rpc, context, headers } = await runtime(input.siteId);
      const response = await call(() => rpc.listRatedUsage({ context, siteId: input.siteId, pageSize: 100,
        ...optional("creditAccountRef", input.creditAccountRef), ...optional("creditGrantId", input.creditGrantId),
        ...optional("creditHoldRef", input.creditHoldRef), ...sourceInput(input),
        ...optional("executionRootRef", input.executionRootRef), ...optional("attemptRef", input.attemptRef),
        ...optional("pageToken", input.pageToken) }, { headers }));
      assertItems(response.ratedUsage, input.siteId, (item) => {
        assertOptional(item.creditAccountRef, input.creditAccountRef);
        assertOptional(item.creditHoldRef, input.creditHoldRef);
        assertOptional(item.executionRootRef, input.executionRootRef);
        assertOptional(item.attemptRef, input.attemptRef);
      });
      return listJson(response, response.ratedUsage.map(ratedUsageJson));
    },
    async listRatedUsageSourceAllocations(input: PageInput & Readonly<{ trace: RatedUsageAllocationTrace }>) {
      const { rpc, context, headers } = await runtime(input.siteId);
      const trace = input.trace.kind === "usage" ? { case: "ratedUsageRef" as const, value: input.trace.ref } :
        { case: "settlementRef" as const, value: input.trace.ref };
      const response = await call(() => rpc.listRatedUsageSourceAllocations({ context, siteId: input.siteId, trace,
        pageSize: 100, ...optional("pageToken", input.pageToken) }, { headers }));
      assertItems(response.allocations, input.siteId, (item) => assertEqual(
        input.trace.kind === "usage" ? item.ratedUsageRef : item.settlementRef, input.trace.ref));
      return listJson(response, response.allocations.map(ratedUsageSourceAllocationJson));
    },
  });
}

async function liveRuntime(siteId: string): Promise<CreditRuntime> {
  const session = await requireAuthoritySession();
  return { rpc: createClient(AdminCreditService, await adminControlPlaneTransport()),
    context: queryContext(session, { kind: "site", siteId }), headers: authHeaders(session) };
}

export const adminCreditReader = createAdminCreditReader(liveRuntime);

function balanceJson(value: CreditBalanceSummary) {
  return { unit: value.unit, availableAmount: value.availableAmount, reservedAmount: value.reservedAmount,
    consumedAmount: value.consumedAmount, expiredAmount: value.expiredAmount, revokedAmount: value.revokedAmount,
    recoveryExposureAmount: value.recoveryExposureAmount };
}
function siteSummaryJson(value: SiteCreditSummary) {
  if (value.freshness !== CreditReadFreshness.AUTHORITATIVE_DATABASE_OBSERVATION) throw invalidResponse();
  return { siteId: value.siteId, creditAccountCount: value.creditAccountCount.toString(),
    activeCreditAccountCount: value.activeCreditAccountCount.toString(), openHoldCount: value.openHoldCount.toString(),
    reconciliationRequiredHoldCount: value.reconciliationRequiredHoldCount.toString(),
    balances: value.balances.map(balanceJson), freshness: "database_observation" as const,
    asOf: requiredInstant(value.asOf) };
}
function accountJson(value: CreditAccountSummary) {
  if (value.freshness !== CreditReadFreshness.AUTHORITATIVE_DATABASE_OBSERVATION || value.balance === undefined) {
    throw invalidResponse();
  }
  return { siteId: value.siteId, creditAccountRef: value.creditAccountRef,
    billingAccountRef: value.billingAccountRef, unit: value.unit, state: accountState(value.state),
    aggregateVersion: value.aggregateVersion.toString(), balance: balanceJson(value.balance),
    grantCount: value.grantCount.toString(), openHoldCount: value.openHoldCount.toString(),
    reconciliationRequiredHoldCount: value.reconciliationRequiredHoldCount.toString(),
    createdAt: requiredInstant(value.createdAt), updatedAt: requiredInstant(value.updatedAt),
    freshness: "database_observation" as const, asOf: requiredInstant(value.asOf) };
}
function grantJson(value: CreditGrantSummary) {
  return { siteId: value.siteId, creditGrantId: value.creditGrantId, creditAccountRef: value.creditAccountRef,
    billingAccountRef: value.billingAccountRef, creditProgramRevisionRef: value.creditProgramRevisionRef,
    sourceType: sourceType(value.sourceType), sourceRef: value.sourceRef,
    issuanceJournalTransactionRef: value.issuanceJournalTransactionRef, bucketClass: bucketClass(value.uxBucketClass),
    unit: value.unit, originalAmount: value.originalAmount, burnPriority: value.burnPriority,
    effectiveAt: requiredInstant(value.effectiveAt), expiresAt: optionalInstant(value.expiresAt),
    issuedAt: requiredInstant(value.issuedAt), relatedHoldCount: value.relatedHoldCount.toString(),
    relatedExecutionCount: value.relatedExecutionCount.toString() };
}
function holdJson(value: CreditHoldSummary) {
  return { siteId: value.siteId, creditHoldRef: value.creditHoldRef, creditAccountRef: value.creditAccountRef,
    executionRootRef: value.executionRootRef, unit: value.unit, requestedAmount: value.requestedAmount,
    reservedAmount: value.reservedAmount, capturedAmount: value.capturedAmount, releasedAmount: value.releasedAmount,
    state: holdState(value.state), resolutionKind: value.resolutionKind === undefined ? null :
      holdResolution(value.resolutionKind), resolutionRef: value.resolutionRef ?? null,
    fenceEpoch: value.fenceEpoch.toString(), expiresAt: requiredInstant(value.expiresAt),
    settledAt: optionalInstant(value.settledAt), releasedAt: optionalInstant(value.releasedAt),
    createdAt: requiredInstant(value.createdAt), updatedAt: requiredInstant(value.updatedAt),
    grantCount: value.grantCount.toString(), sourceCount: value.sourceCount.toString() };
}
function holdAllocationJson(value: CreditHoldAllocationSummary) {
  return { siteId: value.siteId, creditHoldRef: value.creditHoldRef, creditGrantId: value.creditGrantId,
    creditAccountRef: value.creditAccountRef, unit: value.unit,
    reserveJournalTransactionRef: value.reserveJournalTransactionRef, allocatedAmount: value.allocatedAmount,
    allocationOrdinal: value.allocationOrdinal, createdAt: requiredInstant(value.createdAt) };
}
function journalTransactionJson(value: CreditJournalTransactionSummary) {
  return { siteId: value.siteId, journalTransactionRef: value.journalTransactionRef,
    creditAccountRef: value.creditAccountRef, unit: value.unit, businessOperationKey: value.businessOperationKey,
    operationKind: journalOperation(value.operationKind), entryCount: value.entryCount,
    reversalOfTransactionRef: value.reversalOfTransactionRef ?? null,
    occurredAt: requiredInstant(value.occurredAt), createdAt: requiredInstant(value.createdAt) };
}
function journalEntryJson(value: CreditJournalEntrySummary) {
  return { siteId: value.siteId, journalTransactionRef: value.journalTransactionRef,
    entryOrdinal: value.entryOrdinal, creditAccountRef: value.creditAccountRef, unit: value.unit,
    entrySide: journalSide(value.entrySide), accountType: journalAccount(value.accountType), amount: value.amount,
    creditGrantId: value.creditGrantId, creditHoldRef: value.creditHoldRef ?? null,
    sourceType: sourceType(value.sourceType), sourceRef: value.sourceRef,
    executionRootRef: value.executionRootRef ?? null, createdAt: requiredInstant(value.createdAt) };
}
function ratedUsageJson(value: RatedUsageSummary) {
  return { siteId: value.siteId, ratedUsageRef: value.ratedUsageRef,
    authorizationSegmentRef: value.authorizationSegmentRef, closureRef: value.closureRef,
    settlementRef: value.settlementRef, attemptRef: value.attemptRef, executionRootRef: value.executionRootRef,
    creditHoldRef: value.creditHoldRef, creditAccountRef: value.creditAccountRef, unit: value.unit,
    policyRatedAmount: value.policyRatedAmount, customerAmount: value.customerAmount,
    platformExposureAmount: value.platformExposureAmount, lineItemCount: value.lineItemCount,
    sourceCount: value.sourceCount.toString(), createdAt: requiredInstant(value.createdAt) };
}
function ratedUsageSourceAllocationJson(value: RatedUsageSourceAllocationSummary) {
  return { siteId: value.siteId, ratedUsageRef: value.ratedUsageRef, settlementRef: value.settlementRef,
    creditGrantId: value.creditGrantId, direction: usageDirection(value.direction), amount: value.amount,
    allocationOrdinal: value.allocationOrdinal };
}

function listJson<Item>(response: Readonly<{ nextPageToken?: string; membershipWatermark?: TimestampLike;
  observedAt?: TimestampLike }>, items: readonly Item[]) {
  return { items, nextPageToken: response.nextPageToken ?? null,
    membershipWatermark: requiredInstant(response.membershipWatermark), observedAt: requiredInstant(response.observedAt) };
}
type TimestampLike = Readonly<{ seconds: bigint; nanos: number }>;
function requiredInstant(value: TimestampLike | undefined): string {
  if (value === undefined) throw invalidResponse();
  return new Date(Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000)).toISOString();
}
function optionalInstant(value: TimestampLike | undefined): string | null {
  return value === undefined ? null : requiredInstant(value);
}
function optional<Key extends string>(key: Key, value: string | undefined): Partial<Record<Key, string>> {
  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, string>>;
}
function assertEqual(actual: string, expected: string): void {
  if (actual !== expected) throw invalidResponse();
}
function assertOptional(actual: string, expected: string | undefined): void {
  if (expected !== undefined) assertEqual(actual, expected);
}
function assertItems<Item extends Readonly<{ siteId: string }>>(items: readonly Item[], siteId: string,
  validate: (item: Item) => void = () => {}): void {
  for (const item of items) {
    assertEqual(item.siteId, siteId);
    validate(item);
  }
}
function sourceInput(value: SourceFilter) {
  if ((value.sourceType === undefined) !== (value.sourceRef === undefined)) {
    throw new AdminControlPlaneError(Code.InvalidArgument, "credit.source_filter_incomplete");
  }
  return value.sourceType === undefined ? {} : { sourceType: sourceTypeWire(value.sourceType), sourceRef: value.sourceRef };
}

function accountState(value: CreditAccountState) { return mapEnum(value, {
  [CreditAccountState.ACTIVE]: "active", [CreditAccountState.SUSPENDED]: "suspended",
  [CreditAccountState.CLOSED]: "closed",
} as const); }
function sourceType(value: CreditGrantSourceType) { return mapEnum(value, {
  [CreditGrantSourceType.REDEMPTION]: "redemption", [CreditGrantSourceType.PAYMENT]: "payment",
  [CreditGrantSourceType.ADMIN_GRANT]: "admin_grant", [CreditGrantSourceType.PROGRAM_WINDOW]: "program_window",
} as const); }
function sourceTypeWire(value: CreditSourceType): CreditGrantSourceType { return {
  redemption: CreditGrantSourceType.REDEMPTION, payment: CreditGrantSourceType.PAYMENT,
  admin_grant: CreditGrantSourceType.ADMIN_GRANT, program_window: CreditGrantSourceType.PROGRAM_WINDOW,
}[value]; }
function bucketClass(value: CreditBucketClass) { return mapEnum(value, {
  [CreditBucketClass.DAILY]: "daily", [CreditBucketClass.PERIOD]: "period",
  [CreditBucketClass.PERMANENT]: "permanent",
} as const); }
function holdState(value: CreditHoldState) { return mapEnum(value, {
  [CreditHoldState.OPEN]: "open", [CreditHoldState.CLOSING]: "closing", [CreditHoldState.SETTLED]: "settled",
  [CreditHoldState.RELEASED]: "released", [CreditHoldState.EXPIRED]: "expired",
  [CreditHoldState.RECONCILIATION_REQUIRED]: "reconciliation_required",
} as const); }
function holdResolution(value: CreditHoldResolutionKind) { return mapEnum(value, {
  [CreditHoldResolutionKind.RESERVATION_EXPIRY]: "reservation_expiry",
  [CreditHoldResolutionKind.KNOWN_OUTCOME]: "known_outcome",
  [CreditHoldResolutionKind.RECONCILED]: "reconciled",
} as const); }
function journalOperation(value: CreditJournalOperationKind) { return mapEnum(value, {
  [CreditJournalOperationKind.GRANT_ISSUE]: "grant_issue", [CreditJournalOperationKind.HOLD_RESERVE]: "hold_reserve",
  [CreditJournalOperationKind.HOLD_CAPTURE]: "hold_capture", [CreditJournalOperationKind.HOLD_RELEASE]: "hold_release",
  [CreditJournalOperationKind.GRANT_EXPIRE]: "grant_expire", [CreditJournalOperationKind.GRANT_REVOKE]: "grant_revoke",
  [CreditJournalOperationKind.CORRECTION]: "correction", [CreditJournalOperationKind.REVERSAL]: "reversal",
} as const); }
function journalSide(value: CreditJournalEntrySide) { return mapEnum(value, {
  [CreditJournalEntrySide.DEBIT]: "debit", [CreditJournalEntrySide.CREDIT]: "credit",
} as const); }
function journalAccount(value: CreditJournalAccountType) { return mapEnum(value, {
  [CreditJournalAccountType.GRANT_ISSUANCE_SOURCE]: "grant_issuance_source",
  [CreditJournalAccountType.CUSTOMER_AVAILABLE]: "customer_available",
  [CreditJournalAccountType.CUSTOMER_RESERVED]: "customer_reserved",
  [CreditJournalAccountType.CUSTOMER_CONSUMED]: "customer_consumed",
  [CreditJournalAccountType.EXPIRED]: "expired", [CreditJournalAccountType.REVOKED]: "revoked",
  [CreditJournalAccountType.ADJUSTMENT]: "adjustment",
  [CreditJournalAccountType.RECOVERY_EXPOSURE]: "recovery_exposure",
} as const); }
function usageDirection(value: CreditUsageSourceDirection) { return mapEnum(value, {
  [CreditUsageSourceDirection.CAPTURE]: "capture", [CreditUsageSourceDirection.INCREASE]: "increase",
  [CreditUsageSourceDirection.DECREASE]: "decrease",
} as const); }
function mapEnum<Value extends number, Output extends string>(value: Value,
  values: Readonly<Partial<Record<Value, Output>>>): Output {
  const mapped = values[value];
  if (mapped === undefined) throw invalidResponse();
  return mapped;
}

async function call<Value>(invoke: () => Promise<Value>): Promise<Value> {
  try { return await invoke(); }
  catch (reason) {
    if (reason instanceof AdminControlPlaneError) throw reason;
    const error = ConnectError.from(reason); const detail = error.findDetails(KokoroErrorDetailSchema)[0];
    throw new AdminControlPlaneError(error.code, detail?.domainCode || "admin_credit.unavailable",
      detail?.receiptRef || null);
  }
}
function invalidResponse() { return new AdminCreditInvalidResponseError(); }
