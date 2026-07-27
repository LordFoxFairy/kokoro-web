import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import { KokoroErrorDetailSchema, RetryClass } from "@/lib/generated/contracts/kokoro/common/v1/error_pb";
import { CommandReceiptState } from "@/lib/generated/contracts/kokoro/common/v1/receipt_pb";
import {
  AdminAuthService,
  AuthEventKind,
  OperatorStatus,
} from "@/lib/generated/contracts/kokoro/platform/admin/v1/admin_auth_pb";
import {
  AdminAuthClientError,
  createAdminAuthClient,
  createWorkloadInterceptor,
} from "@/lib/auth/client";

const NOW = new Date("2033-05-18T03:33:20.000Z");
const EXPIRES = new Date("2033-05-18T03:43:20.000Z");

function commandIds(): () => string {
  let next = 0;
  return () => `command-${++next}`;
}

describe("Admin Auth generated Connect client", () => {
  it("maps generated operator responses and NotFound to the Auth.js port", async () => {
    const transport = createRouterTransport((router) => {
      router.service(AdminAuthService, {
        getOperatorByEmail(request) {
          if (request.email === "missing@example.com") {
            throw new ConnectError("not found", Code.NotFound);
          }
          return {
            operator: {
              id: request.email.startsWith("disabled") ? "operator-disabled" : "operator-active",
              email: request.email,
              displayName: "Admin",
              status: request.email.startsWith("disabled") ? OperatorStatus.DISABLED : OperatorStatus.ACTIVE,
            },
          };
        },
      });
    });
    const client = createAdminAuthClient({ transport, newCommandId: commandIds(), now: () => NOW });

    await expect(client.findOperatorByEmail(" Admin@Kokoro.Local ")).resolves.toEqual({
      id: "operator-active",
      email: "admin@kokoro.local",
      displayName: "Admin",
      status: "active",
    });
    await expect(client.findOperatorByEmail("disabled@example.com")).resolves.toMatchObject({ status: "disabled" });
    await expect(client.findOperatorByEmail("missing@example.com")).resolves.toBeNull();
  });

  it("sends command identity and digest for token effects", async () => {
    const createRequest = vi.fn();
    const consumeRequest = vi.fn();
    const transport = createRouterTransport((router) => {
      router.service(AdminAuthService, {
        createVerificationToken(request) {
          createRequest(request);
          return {
            verificationToken: {
              identifier: request.identifier,
              token: request.token,
              expires: request.expires,
            },
            receipt: {
              identity: request.command,
              operation: "admin_auth.create_verification_token",
              state: CommandReceiptState.COMMITTED,
              recordedAt: timestampFromDate(NOW),
            },
          };
        },
        consumeVerificationToken(request) {
          consumeRequest(request);
          throw new ConnectError("not found", Code.NotFound);
        },
      });
    });
    const client = createAdminAuthClient({ transport, newCommandId: commandIds(), now: () => NOW });

    await expect(
      client.createVerificationToken({ identifier: " Admin@Kokoro.Local ", token: "token-1", expires: EXPIRES }),
    ).resolves.toEqual({ identifier: "admin@kokoro.local", token: "token-1", expires: EXPIRES });
    const created = createRequest.mock.calls[0]?.[0];
    expect(created.command).toMatchObject({ commandId: "command-1", idempotencyKey: "command-1" });
    expect(created.command.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(created.identifier).toBe("admin@kokoro.local");

    await expect(
      client.consumeVerificationToken({ identifier: " Admin@Kokoro.Local ", token: "token-1" }),
    ).resolves.toBeNull();
    const consumed = consumeRequest.mock.calls[0]?.[0];
    expect(consumed.command).toMatchObject({ commandId: "command-2", idempotencyKey: "command-2" });
    expect(consumed.command.requestDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reconciles a deadline with the same command identity and digest", async () => {
    let attemptedCommand: { commandId: string; requestDigest: string } | undefined;
    const receiptRequest = vi.fn();
    const transport = createRouterTransport((router) => {
      router.service(AdminAuthService, {
        createVerificationToken(request) {
          attemptedCommand = {
            commandId: request.command!.commandId,
            requestDigest: request.command!.requestDigest,
          };
          throw new ConnectError("response lost after commit", Code.DeadlineExceeded);
        },
        getCommandReceipt(request) {
          receiptRequest(request);
          if (receiptRequest.mock.calls.length === 1) {
            throw new ConnectError("receipt not visible yet", Code.NotFound);
          }
          if (receiptRequest.mock.calls.length === 2) {
            return {
              receipt: {
                identity: {
                  commandId: request.commandId,
                  idempotencyKey: request.commandId,
                  requestDigest: request.requestDigest,
                },
                operation: "CreateVerificationToken",
                state: CommandReceiptState.ACCEPTED,
                recordedAt: timestampFromDate(NOW),
              },
            };
          }
          return {
            receipt: {
              identity: {
                commandId: request.commandId,
                idempotencyKey: request.commandId,
                requestDigest: request.requestDigest,
              },
              operation: "admin_auth.create_verification_token",
              state: CommandReceiptState.COMMITTED,
              recordedAt: timestampFromDate(NOW),
            },
            result: {
              case: "verificationToken",
              value: { identifier: "admin@kokoro.local", expires: timestampFromDate(EXPIRES), consumed: false },
            },
          };
        },
      });
    });
    const client = createAdminAuthClient({
      transport,
      newCommandId: commandIds(),
      now: () => NOW,
      waitBeforeReceiptRetry: async () => undefined,
    });

    await expect(
      client.createVerificationToken({ identifier: "admin@kokoro.local", token: "token-1", expires: EXPIRES }),
    ).resolves.toEqual({ identifier: "admin@kokoro.local", token: "token-1", expires: EXPIRES });
    expect(receiptRequest).toHaveBeenCalledTimes(3);
    expect(receiptRequest).toHaveBeenCalledWith(expect.objectContaining(attemptedCommand!));
  });

  it.each([
    ["missing", Code.NotFound, undefined],
    ["lookup timeout", Code.DeadlineExceeded, undefined],
    ["lookup unavailable", Code.Unavailable, undefined],
    ["accepted", undefined, CommandReceiptState.ACCEPTED],
  ] as const)("keeps the original receipt reference when reconciliation is %s", async (_name, code, state) => {
    let attemptedCommand: { commandId: string; requestDigest: string } | undefined;
    const receiptRequest = vi.fn();
    const transport = createRouterTransport((router) => {
      router.service(AdminAuthService, {
        createVerificationToken(request) {
          attemptedCommand = {
            commandId: request.command!.commandId,
            requestDigest: request.command!.requestDigest,
          };
          throw new ConnectError("effect deadline", Code.DeadlineExceeded);
        },
        getCommandReceipt(request) {
          receiptRequest(request);
          if (code !== undefined) throw new ConnectError("receipt unavailable", code);
          return {
            receipt: {
              identity: {
                commandId: request.commandId,
                idempotencyKey: request.commandId,
                requestDigest: request.requestDigest,
              },
              operation: "CreateVerificationToken",
              state: state!,
              recordedAt: timestampFromDate(NOW),
            },
          };
        },
      });
    });
    const client = createAdminAuthClient({
      transport,
      newCommandId: commandIds(),
      now: () => NOW,
      waitBeforeReceiptRetry: async () => undefined,
    });

    const failure = await client
      .createVerificationToken({ identifier: "admin@kokoro.local", token: "token-1", expires: EXPIRES })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AdminAuthClientError);
    expect(failure).toMatchObject({
      connectCode: Code.DeadlineExceeded,
      domainCode: "admin_auth.outcome_unknown",
      retryClass: RetryClass.RECONCILE_RECEIPT,
      receiptRef: "command-1",
    });
    expect(receiptRequest).toHaveBeenCalledTimes(3);
    for (const [request] of receiptRequest.mock.calls) {
      expect(request).toEqual(expect.objectContaining(attemptedCommand!));
    }
  });

  it("keeps a rejected receipt tied to the original command", async () => {
    const receiptRequest = vi.fn();
    const transport = createRouterTransport((router) => {
      router.service(AdminAuthService, {
        createVerificationToken() {
          throw new ConnectError("effect deadline", Code.DeadlineExceeded);
        },
        getCommandReceipt(request) {
          receiptRequest(request);
          return {
            receipt: {
              identity: {
                commandId: request.commandId,
                idempotencyKey: request.commandId,
                requestDigest: request.requestDigest,
              },
              operation: "CreateVerificationToken",
              state: CommandReceiptState.REJECTED,
              recordedAt: timestampFromDate(NOW),
            },
          };
        },
      });
    });
    const client = createAdminAuthClient({ transport, newCommandId: commandIds(), now: () => NOW });

    await expect(
      client.createVerificationToken({ identifier: "admin@kokoro.local", token: "token-1", expires: EXPIRES }),
    ).rejects.toMatchObject({
      domainCode: "admin_auth.outcome_unknown",
      retryClass: RetryClass.RECONCILE_RECEIPT,
      receiptRef: "command-1",
    });
    expect(receiptRequest).toHaveBeenCalledTimes(1);
  });

  it("maps auth events and keeps transport failures free of raw input", async () => {
    const eventRequest = vi.fn();
    const transport = createRouterTransport((router) => {
      router.service(AdminAuthService, {
        recordAuthEvent(request) {
          eventRequest(request);
          return {
            receipt: {
              identity: request.command,
              operation: "admin_auth.record_auth_event",
              state: CommandReceiptState.COMMITTED,
              recordedAt: timestampFromDate(NOW),
            },
          };
        },
        getOperator(request) {
          throw new ConnectError(`leaked:${request.id}:bridge-secret`, Code.Unavailable, undefined, [
            {
              desc: KokoroErrorDetailSchema,
              value: create(KokoroErrorDetailSchema, {
                domainCode: "admin_auth.persistence_unavailable",
                retryClass: RetryClass.AFTER_DELAY,
                requestId: "request-1",
                correlationId: "correlation-1",
                safeMessage: "Persistence unavailable",
                receiptRef: "receipt-1",
              }),
            },
          ]);
        },
      });
    });
    const client = createAdminAuthClient({ transport, newCommandId: commandIds(), now: () => NOW });

    await client.recordAuthEvent({ email: " Admin@Kokoro.Local ", event: "signin" });
    expect(eventRequest.mock.calls[0]?.[0]).toMatchObject({
      email: "admin@kokoro.local",
      event: AuthEventKind.SIGN_IN,
    });

    const failure = await client.findOperatorById("operator-secret").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AdminAuthClientError);
    expect(failure).toMatchObject({
      connectCode: Code.Unavailable,
      domainCode: "admin_auth.persistence_unavailable",
      retryClass: RetryClass.AFTER_DELAY,
      receiptRef: "receipt-1",
    });
    expect(String(failure)).not.toContain("operator-secret");
    expect(String(failure)).not.toContain("bridge-secret");
  });

  it("injects the frozen temporary workload metadata in one interceptor", async () => {
    const seen = vi.fn();
    const interceptor = createWorkloadInterceptor({
      workload: "admin-web",
      audience: "admin-web",
      environment: "test",
      proxySecret: "bridge-secret",
    });
    const transport = createRouterTransport(
      (router) => {
        router.service(AdminAuthService, {
          getOperator(_request, context) {
            seen(Object.fromEntries(context.requestHeader));
            throw new ConnectError("not found", Code.NotFound);
          },
        });
      },
      { transport: { interceptors: [interceptor] } },
    );
    const client = createAdminAuthClient({ transport, newCommandId: commandIds(), now: () => NOW });

    await expect(client.findOperatorById("missing")).resolves.toBeNull();
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        "x-kokoro-workload": "admin-web",
        "x-kokoro-audience": "admin-web",
        "x-kokoro-environment": "test",
        "x-kokoro-proxy-secret": "bridge-secret",
      }),
    );
  });
});
