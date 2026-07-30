import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";

import { adminWorkloadConfig } from "./config";
import { adminControlPlaneTransport } from "./transport";
import { beginOperatorLoginRequestDigest, beginStepUpRequestDigest, completeStepUpRequestDigest,
  exchangeOidcSessionRequestDigest, signOutRequestDigest } from
  "@/lib/generated/admin-identity/command-envelope-digest";
import { KokoroErrorDetailSchema } from "@/lib/generated/admin-identity/kokoro/common/v1/error_pb";
import { CommandDigestAlgorithmV2, CommandIdentityV2Schema, CommandReceiptStateV2, OperatorAssuranceLevel } from
  "@/lib/generated/admin-identity/kokoro/common/v2/command_envelope_pb";
import {
  AdminAuthTransactionContextSchema,
  AdminIdentityService,
  AdminPreLoginWorkloadContextSchema,
  AdminSessionRecoveryProofSchema,
  BeginStepUpEffectSchema,
  BeginOperatorLoginEffectSchema,
  CompleteStepUpEffectSchema,
  ExchangeOidcSessionEffectSchema,
  SignOutEffectSchema,
} from "@/lib/generated/admin-identity/kokoro/platform/identity/v1/admin_identity_pb";
import { authHeaders, commandContext, verifiedAxes } from "./client";
import { requireAuthoritySession } from "./authority-session";

export class AdminIdentityError extends Error {
  constructor(readonly code: Code, readonly domainCode: string) {
    super("admin_identity_request_failed");
    this.name = "AdminIdentityError";
  }
}

export interface BegunAdminLogin {
  readonly transactionRef: string;
  readonly authorizationUri: string;
  readonly recoveryHandle: string;
  readonly recoveryExpiresAt: string;
}

export interface ExchangedAdminLogin {
  readonly envelope: string;
  readonly operatorSessionRef: string;
  readonly exchangeRequestDigest: string;
}

export async function beginAdminLogin(): Promise<BegunAdminLogin> {
  const config = await adminWorkloadConfig();
  const rpc = createClient(AdminIdentityService, await adminControlPlaneTransport());
  const recovery = randomBytes(32);
  const recoveryProof = create(AdminSessionRecoveryProofSchema, { recoveryHandle: recovery });
  const effect = create(BeginOperatorLoginEffectSchema, { returnIntentRef: config.returnIntentRef, recoveryProof });
  const commandId = randomUUID();
  const context = create(AdminPreLoginWorkloadContextSchema, {
    command: identity(commandId, "0".repeat(64)), ...config.axes,
  });
  const identityValue = context.command!;
  identityValue.requestDigest = beginOperatorLoginRequestDigest(context, effect, config.axes);
  try {
    const response = await rpc.beginOperatorLogin({ context, effect });
    committed(response.receipt, commandId, identityValue.requestDigest);
    if (response.expiresAt === undefined || response.recoveryExpiresAt === undefined) throw invalidResponse();
    return Object.freeze({ transactionRef: response.transactionRef, authorizationUri: response.authorizationUri,
      recoveryHandle: recovery.toString("base64url"),
      recoveryExpiresAt: timestamp(response.recoveryExpiresAt) });
  } catch (error) {
    throw typed(error);
  }
}

export async function exchangeAdminLogin(input: Readonly<{
  transactionRef: string; authorizationCode: string; recoveryHandle: string;
}>): Promise<ExchangedAdminLogin> {
  const config = await adminWorkloadConfig();
  const rpc = createClient(AdminIdentityService, await adminControlPlaneTransport());
  const recoveryProof = create(AdminSessionRecoveryProofSchema, {
    recoveryHandle: canonicalRecovery(input.recoveryHandle),
  });
  const effect = create(ExchangeOidcSessionEffectSchema, {
    transactionRef: input.transactionRef, authorizationCode: input.authorizationCode, recoveryProof,
  });
  const commandId = randomUUID();
  const context = create(AdminAuthTransactionContextSchema, {
    command: identity(commandId, "0".repeat(64)), ...config.axes,
  });
  const identityValue = context.command!;
  identityValue.requestDigest = exchangeOidcSessionRequestDigest(context, effect, config.axes);
  try {
    const response = await rpc.exchangeOidcSession({ context, effect });
    committed(response.receipt, commandId, identityValue.requestDigest);
    if (response.delivery === undefined) throw invalidResponse();
    return Object.freeze({ envelope: response.delivery.sessionDeliveryEnvelope,
      operatorSessionRef: response.delivery.operatorSessionRef,
      exchangeRequestDigest: identityValue.requestDigest });
  } catch (error) {
    const connect = ConnectError.from(error);
    if (![Code.DeadlineExceeded, Code.Unavailable].includes(connect.code)) throw typed(error);
    try {
      const recovered = await rpc.getOperatorSessionDelivery({
        context: { requestId: randomUUID(), ...config.axes }, transactionRef: input.transactionRef, recoveryProof,
      });
      if (recovered.delivery === undefined) throw invalidResponse();
      committed(recovered.originalExchangeReceipt, commandId, identityValue.requestDigest);
      return Object.freeze({ envelope: recovered.delivery.sessionDeliveryEnvelope,
        operatorSessionRef: recovered.delivery.operatorSessionRef,
        exchangeRequestDigest: identityValue.requestDigest });
    } catch (recoveryError) {
      throw typed(recoveryError);
    }
  }
}

export async function beginAdminStepUp(input: Readonly<{ operation: string; resourceRefs: readonly string[] }>) {
  const session = await requireAuthoritySession(); const config = await adminWorkloadConfig();
  const rpc = createClient(AdminIdentityService, await adminControlPlaneTransport());
  const effect = create(BeginStepUpEffectSchema, { requestedOperation: input.operation,
    resourceRefs: [...new Set(input.resourceRefs)].sort(), callbackRef: config.stepUpCallbackRef });
  const context = commandContext(session); const identityValue = context.command!;
  identityValue.requestDigest = beginStepUpRequestDigest(context, effect, verifiedAxes(session));
  try { const response = await rpc.beginStepUp({ context, effect }, { headers: authHeaders(session) });
    committed(response.receipt, identityValue.commandId, identityValue.requestDigest);
    if (response.expiresAt === undefined) throw invalidResponse();
    return Object.freeze({ transactionRef: response.transactionRef, authorizationUri: response.authorizationUri,
      expiresAt: timestampDate(response.expiresAt).toISOString() });
  } catch (error) { throw typed(error); }
}

export async function completeAdminStepUp(input: Readonly<{ transactionRef: string; authorizationCode: string }>) {
  const session = await requireAuthoritySession(); const rpc = createClient(AdminIdentityService, await adminControlPlaneTransport());
  const effect = create(CompleteStepUpEffectSchema, { transactionRef: input.transactionRef,
    authorizationCode: input.authorizationCode });
  const context = commandContext(session); const identityValue = context.command!;
  identityValue.requestDigest = completeStepUpRequestDigest(context, effect, verifiedAxes(session));
  try { const response = await rpc.completeStepUp({ context, effect }, { headers: authHeaders(session) });
    committed(response.receipt, identityValue.commandId, identityValue.requestDigest);
    const stepUpAt = response.stepUpAt === undefined ? null : timestampDate(response.stepUpAt).toISOString();
    const expectedEpoch = BigInt(session.sessionEpoch) + 1n;
    const expectedRef = `admin-session:${session.operatorSessionRef}:${expectedEpoch.toString()}`;
    const expectedDigest = createHash("sha256").update("kokoro.admin-operator-attestation.v1").update("\0")
      .update(JSON.stringify({ ref: expectedRef, operatorRef: session.operatorRef,
        operatorGeneration: session.operatorGeneration, operatorSecurityEpoch: session.operatorSecurityEpoch,
        restrictionEpoch: session.restrictionEpoch, policyEpoch: session.policyEpoch,
        workloadIdentityRef: session.workloadIdentityRef, environment: session.environment, region: session.region,
        managedDeviceRef: session.managedDeviceRef, audience: session.audience })).digest("hex");
    if (stepUpAt === null || response.operatorSessionRef !== session.operatorSessionRef ||
        response.sessionEpoch !== expectedEpoch || response.assuranceLevel !== OperatorAssuranceLevel.PHISHING_RESISTANT ||
        response.factorClasses.length < 1 || response.operatorAttestationRef !== expectedRef ||
        response.operatorAttestationDigest !== expectedDigest) throw invalidResponse();
    return Object.freeze({ stepUpAt, sessionEpoch: response.sessionEpoch.toString(),
      assuranceLevel: "phishing_resistant" as const, factorClasses: [...response.factorClasses],
      operatorAttestationRef: response.operatorAttestationRef,
      operatorAttestationDigest: response.operatorAttestationDigest });
  } catch (error) { throw typed(error); }
}

export async function signOutAdminSession(): Promise<void> {
  const session = await requireAuthoritySession(); const rpc = createClient(AdminIdentityService, await adminControlPlaneTransport());
  const effect = create(SignOutEffectSchema, { operatorSessionRef: session.operatorSessionRef });
  const context = commandContext(session); const identityValue = context.command!;
  identityValue.requestDigest = signOutRequestDigest(context, effect, verifiedAxes(session));
  try { const response = await rpc.signOut({ context, effect }, { headers: authHeaders(session) });
    committed(response.receipt, identityValue.commandId, identityValue.requestDigest);
  } catch (error) { throw typed(error); }
}

function identity(commandId: string, requestDigest: string) {
  return create(CommandIdentityV2Schema, { commandId, idempotencyKey: commandId,
    digestAlgorithm: CommandDigestAlgorithmV2.SHA256_COMMAND_ENVELOPE, requestDigest });
}

function committed(receipt: Readonly<{ state: CommandReceiptStateV2; identity?: Readonly<{
  commandId: string; requestDigest: string;
}> }> | undefined, commandId: string, digest: string): void {
  if (receipt?.state !== CommandReceiptStateV2.COMMITTED || receipt.identity?.commandId !== commandId ||
      receipt.identity.requestDigest !== digest) throw invalidResponse();
}

function typed(reason: unknown): AdminIdentityError {
  if (reason instanceof AdminIdentityError) return reason;
  const error = ConnectError.from(reason);
  const detail = error.findDetails(KokoroErrorDetailSchema)[0];
  return new AdminIdentityError(error.code, detail?.domainCode || "admin_identity.unavailable");
}
function invalidResponse(): AdminIdentityError {
  return new AdminIdentityError(Code.Internal, "admin_identity.invalid_response");
}
function canonicalRecovery(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new AdminIdentityError(Code.InvalidArgument, "admin_identity.invalid_recovery");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value) throw invalidResponse();
  return decoded;
}
function timestamp(value: Readonly<{ seconds: bigint; nanos: number }>): string {
  return new Date(Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000)).toISOString();
}
