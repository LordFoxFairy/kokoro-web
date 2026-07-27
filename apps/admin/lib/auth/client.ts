import "server-only";

import { randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createClient,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";

import { RetryClass, KokoroErrorDetailSchema } from "@/lib/generated/contracts/kokoro/common/v1/error_pb";
import {
  ADMIN_AUTH_COMMAND_DIGEST_ALGORITHM,
  canonicalizeConsumeVerificationTokenEffect,
  canonicalizeCreateVerificationTokenEffect,
  canonicalizeRecordAuthEventEffect,
  consumeVerificationTokenEffectDigest,
  createVerificationTokenEffectDigest,
  recordAuthEventEffectDigest,
} from "@/lib/generated/contracts/admin-auth-effect-digest";
import {
  CommandReceiptState,
  type CommandIdentity,
  type CommandReceipt,
} from "@/lib/generated/contracts/kokoro/common/v1/receipt_pb";
import {
  AdminAuthService,
  AuthEventKind,
  ConsumeVerificationTokenEffectSchema,
  CreateVerificationTokenEffectSchema,
  OperatorStatus,
  RecordAuthEventEffectSchema,
  type GetCommandReceiptResponse,
  type Operator,
  type VerificationToken,
} from "@/lib/generated/contracts/kokoro/platform/admin/v1/admin_auth_pb";

export interface AdminAuthOperator {
  id: string;
  email: string;
  displayName: string;
  status: "active" | "disabled";
}

export interface AdminVerificationToken {
  identifier: string;
  token: string;
  expires: Date;
}

export interface AdminAuthClient {
  findOperatorByEmail(email: string): Promise<AdminAuthOperator | null>;
  findOperatorById(id: string): Promise<AdminAuthOperator | null>;
  createVerificationToken(value: AdminVerificationToken): Promise<AdminVerificationToken>;
  consumeVerificationToken(
    value: Pick<AdminVerificationToken, "identifier" | "token">,
  ): Promise<AdminVerificationToken | null>;
  recordAuthEvent(value: {
    email: string;
    event: "signin" | "signout" | "denied";
    reason?: string;
  }): Promise<void>;
}

export class AdminAuthClientError extends Error {
  readonly connectCode: Code;
  readonly domainCode: string;
  readonly retryClass: RetryClass;
  readonly receiptRef: string | null;

  constructor(options: {
    connectCode: Code;
    domainCode: string;
    retryClass: RetryClass;
    receiptRef?: string;
  }) {
    super("admin_auth_request_failed");
    this.name = "AdminAuthClientError";
    this.connectCode = options.connectCode;
    this.domainCode = options.domainCode;
    this.retryClass = options.retryClass;
    this.receiptRef = options.receiptRef ?? null;
  }
}

export interface WorkloadInterceptorConfig {
  workload: "admin-web";
  audience: "admin-web";
  environment: "development" | "test" | "production";
  proxySecret: string;
}

export function createWorkloadInterceptor(config: WorkloadInterceptorConfig): Interceptor {
  return (next) => async (request) => {
    request.header.set("x-kokoro-workload", config.workload);
    request.header.set("x-kokoro-audience", config.audience);
    request.header.set("x-kokoro-environment", config.environment);
    request.header.set("x-kokoro-proxy-secret", config.proxySecret);
    return next(request);
  };
}

export interface AdminAuthTransportConfig {
  gatewayUrl: string;
  proxySecret: string;
  environment: "development" | "test" | "production";
  timeoutMs?: number;
}

export function createAdminAuthTransport(config: AdminAuthTransportConfig): Transport {
  return createConnectTransport({
    baseUrl: config.gatewayUrl.replace(/\/+$/, ""),
    httpVersion: "1.1",
    useBinaryFormat: false,
    defaultTimeoutMs: config.timeoutMs ?? 5_000,
    readMaxBytes: 64 * 1024,
    writeMaxBytes: 64 * 1024,
    interceptors: [
      createWorkloadInterceptor({
        workload: "admin-web",
        audience: "admin-web",
        environment: config.environment,
        proxySecret: config.proxySecret,
      }),
    ],
  });
}

export interface AdminAuthClientOptions {
  transport: Transport;
  now?: () => Date;
  newCommandId?: () => string;
  waitBeforeReceiptRetry?: (delayMs: number) => Promise<void>;
}

const RECEIPT_LOOKUP_TIMEOUT_MS = 1_000;
const RECEIPT_RECONCILE_DELAYS_MS = [0, 50, 150] as const;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function errorFrom(reason: unknown): AdminAuthClientError {
  const error = ConnectError.from(reason);
  const detail = error.findDetails(KokoroErrorDetailSchema)[0];
  return new AdminAuthClientError({
    connectCode: error.code,
    domainCode: detail?.domainCode || "admin_auth.unavailable",
    retryClass: detail?.retryClass ?? RetryClass.NEVER,
    ...(detail?.receiptRef === undefined ? {} : { receiptRef: detail.receiptRef }),
  });
}

function isConnectCode(reason: unknown, code: Code): boolean {
  return ConnectError.from(reason).code === code;
}

function outcomeUnknown(identity: CommandIdentity): AdminAuthClientError {
  return new AdminAuthClientError({
    connectCode: Code.DeadlineExceeded,
    domainCode: "admin_auth.outcome_unknown",
    retryClass: RetryClass.RECONCILE_RECEIPT,
    receiptRef: identity.commandId,
  });
}

function canRetryReceipt(error: unknown): boolean {
  return (
    error instanceof AdminAuthClientError &&
    [Code.NotFound, Code.Unavailable, Code.DeadlineExceeded].includes(error.connectCode)
  );
}

function operatorFromMessage(operator: Operator | undefined): AdminAuthOperator {
  if (operator === undefined) {
    throw new AdminAuthClientError({
      connectCode: Code.Internal,
      domainCode: "admin_auth.invalid_operator_response",
      retryClass: RetryClass.NEVER,
    });
  }
  const status =
    operator.status === OperatorStatus.ACTIVE
      ? "active"
      : operator.status === OperatorStatus.DISABLED
        ? "disabled"
        : null;
  if (status === null) {
    throw new AdminAuthClientError({
      connectCode: Code.Internal,
      domainCode: "admin_auth.invalid_operator_status",
      retryClass: RetryClass.NEVER,
    });
  }
  return {
    id: operator.id,
    email: operator.email,
    displayName: operator.displayName,
    status,
  };
}

function tokenFromMessage(token: VerificationToken | undefined): AdminVerificationToken {
  if (token?.expires === undefined) {
    throw new AdminAuthClientError({
      connectCode: Code.Internal,
      domainCode: "admin_auth.invalid_token_response",
      retryClass: RetryClass.NEVER,
    });
  }
  return {
    identifier: token.identifier,
    token: token.token,
    expires: timestampDate(token.expires),
  };
}

function committedReceipt(receipt: CommandReceipt | undefined, identity: CommandIdentity): boolean {
  return (
    receipt?.state === CommandReceiptState.COMMITTED &&
    receipt.identity?.commandId === identity.commandId &&
    receipt.identity.digestAlgorithm === identity.digestAlgorithm &&
    receipt.identity.requestDigest === identity.requestDigest
  );
}

function eventKind(value: "signin" | "signout" | "denied"): AuthEventKind {
  switch (value) {
    case "signin":
      return AuthEventKind.SIGN_IN;
    case "signout":
      return AuthEventKind.SIGN_OUT;
    case "denied":
      return AuthEventKind.DENIED;
  }
}

export function createAdminAuthClient(options: AdminAuthClientOptions): AdminAuthClient {
  const rpc = createClient(AdminAuthService, options.transport);
  const now = options.now ?? (() => new Date());
  const newCommandId = options.newCommandId ?? randomUUID;
  const waitBeforeReceiptRetry =
    options.waitBeforeReceiptRetry ??
    ((delayMs: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delayMs)));

  function command(requestDigest: string): CommandIdentity {
    const commandId = newCommandId();
    return {
      $typeName: "kokoro.common.v1.CommandIdentity",
      commandId,
      idempotencyKey: commandId,
      digestAlgorithm: ADMIN_AUTH_COMMAND_DIGEST_ALGORITHM,
      requestDigest,
    };
  }

  async function receipt(identity: CommandIdentity): Promise<GetCommandReceiptResponse> {
    try {
      return await rpc.getCommandReceipt(
        {
          commandId: identity.commandId,
          digestAlgorithm: identity.digestAlgorithm,
          requestDigest: identity.requestDigest,
        },
        { timeoutMs: RECEIPT_LOOKUP_TIMEOUT_MS },
      );
    } catch (error) {
      throw errorFrom(error);
    }
  }

  async function reconcileReceipt<T>(
    identity: CommandIdentity,
    resolveResult: (response: GetCommandReceiptResponse) => T | null,
  ): Promise<T> {
    for (const delayMs of RECEIPT_RECONCILE_DELAYS_MS) {
      if (delayMs > 0) await waitBeforeReceiptRetry(delayMs);
      let resolved: GetCommandReceiptResponse;
      try {
        resolved = await receipt(identity);
      } catch (error) {
        if (canRetryReceipt(error)) continue;
        throw error;
      }
      const result = resolveResult(resolved);
      if (result !== null) return result;
      if (resolved.receipt?.state === CommandReceiptState.REJECTED) break;
    }
    throw outcomeUnknown(identity);
  }

  async function reconcileToken(
    identity: CommandIdentity,
    originalToken: string,
    expectedConsumed: boolean,
  ): Promise<AdminVerificationToken> {
    return reconcileReceipt(identity, (resolved) => {
      if (
        !committedReceipt(resolved.receipt, identity) ||
        resolved.result.case !== "verificationToken" ||
        resolved.result.value.expires === undefined ||
        resolved.result.value.consumed !== expectedConsumed
      ) {
        return null;
      }
      return {
        identifier: resolved.result.value.identifier,
        token: originalToken,
        expires: timestampDate(resolved.result.value.expires),
      };
    });
  }

  return {
    async findOperatorByEmail(email) {
      try {
        const response = await rpc.getOperatorByEmail({ email: normalizeEmail(email) });
        return operatorFromMessage(response.operator);
      } catch (error) {
        if (isConnectCode(error, Code.NotFound)) return null;
        if (error instanceof AdminAuthClientError) throw error;
        throw errorFrom(error);
      }
    },

    async findOperatorById(id) {
      try {
        const response = await rpc.getOperator({ id });
        return operatorFromMessage(response.operator);
      } catch (error) {
        if (isConnectCode(error, Code.NotFound)) return null;
        if (error instanceof AdminAuthClientError) throw error;
        throw errorFrom(error);
      }
    },

    async createVerificationToken(value) {
      const effect = canonicalizeCreateVerificationTokenEffect(
        create(CreateVerificationTokenEffectSchema, {
          identifier: value.identifier,
          token: value.token,
          expires: timestampFromDate(value.expires),
        }),
      );
      const identity = command(createVerificationTokenEffectDigest(effect));
      try {
        const response = await rpc.createVerificationToken({
          command: identity,
          effect,
        });
        if (!committedReceipt(response.receipt, identity)) {
          throw new AdminAuthClientError({
            connectCode: Code.Internal,
            domainCode: "admin_auth.invalid_receipt",
            retryClass: RetryClass.NEVER,
          });
        }
        return tokenFromMessage(response.verificationToken);
      } catch (error) {
        if (isConnectCode(error, Code.DeadlineExceeded)) {
          return reconcileToken(identity, value.token, false);
        }
        if (error instanceof AdminAuthClientError) throw error;
        throw errorFrom(error);
      }
    },

    async consumeVerificationToken(value) {
      const effect = canonicalizeConsumeVerificationTokenEffect(
        create(ConsumeVerificationTokenEffectSchema, {
          identifier: value.identifier,
          token: value.token,
        }),
      );
      const identity = command(consumeVerificationTokenEffectDigest(effect));
      try {
        const response = await rpc.consumeVerificationToken({ command: identity, effect });
        if (!committedReceipt(response.receipt, identity)) {
          throw new AdminAuthClientError({
            connectCode: Code.Internal,
            domainCode: "admin_auth.invalid_receipt",
            retryClass: RetryClass.NEVER,
          });
        }
        return tokenFromMessage(response.verificationToken);
      } catch (error) {
        if (isConnectCode(error, Code.NotFound)) return null;
        if (isConnectCode(error, Code.DeadlineExceeded)) {
          return reconcileToken(identity, value.token, true);
        }
        if (error instanceof AdminAuthClientError) throw error;
        throw errorFrom(error);
      }
    },

    async recordAuthEvent(value) {
      const occurredAt = now();
      const effect = canonicalizeRecordAuthEventEffect(
        create(RecordAuthEventEffectSchema, {
          email: value.email,
          event: eventKind(value.event),
          ...(value.reason === undefined ? {} : { reason: value.reason }),
          occurredAt: timestampFromDate(occurredAt),
        }),
      );
      const identity = command(recordAuthEventEffectDigest(effect));
      try {
        const response = await rpc.recordAuthEvent({
          command: identity,
          effect,
        });
        if (!committedReceipt(response.receipt, identity)) {
          throw new AdminAuthClientError({
            connectCode: Code.Internal,
            domainCode: "admin_auth.invalid_receipt",
            retryClass: RetryClass.NEVER,
          });
        }
      } catch (error) {
        if (isConnectCode(error, Code.DeadlineExceeded)) {
          await reconcileReceipt(identity, (resolved) =>
            committedReceipt(resolved.receipt, identity) && resolved.result.case === "authEvent" ? true : null,
          );
          return;
        }
        if (error instanceof AdminAuthClientError) throw error;
        throw errorFrom(error);
      }
    },
  };
}
