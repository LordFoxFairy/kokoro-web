import { create, toJsonString } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ErrorDetailSchema } from "../../generated/iam/proto/kokoro/common/v1/error_pb";
import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { IamSessionService } from "../../generated/iam/proto/kokoro/iam/v1/session_pb";
import {
  SecurityEventRecordSchema,
  UserRecordSchema,
  type CommandContext,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { createUserActionHandler } from "../../modules/iam/users/actions";
import { loadUserDetail } from "../../modules/iam/users/query";
import { createIamManagementClient } from "../../server/iam/management-client";

const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const commandId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const now = new Date("2026-08-16T10:00:00.000Z");

describe("IAM User server actions", () => {
  it("WEB-INT-USER-002 creates only a standard User and updates the exact versioned User scope", async () => {
    const calls: unknown[] = [];
    const revalidated: string[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        createUser: (request) => {
          calls.push(request);
          return { user: standardUser(request.email, request.name), replayed: false };
        },
        updateUser: (request) => {
          calls.push(request);
          return { user: standardUser(request.email, request.name), replayed: false };
        },
      });
    });
    const handle = createUserActionHandler({
      loadClient: async () => createIamManagementClient(transport),
      revalidatePath: (path) => revalidated.push(path),
    });

    expect(await handle({ operation: "create", email: "new@example.com", name: "New User", image: "", requestId, commandId, reason: "Provision account" }))
      .toEqual({ status: "success", commandId, replayed: false });
    expect(await handle({ operation: "update", userId, email: "updated@example.com", name: "Updated User", image: "https://example.com/avatar.png", expectedVersion: "7", requestId, commandId, reason: "Correct profile" }))
      .toEqual({ status: "success", commandId, replayed: false });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ email: "new@example.com", name: "New User", command: { commandId, reason: "Provision account" } });
    expect(calls[0]).not.toHaveProperty("password");
    expect(calls[0]).not.toHaveProperty("platformRole");
    expect(calls[1]).toMatchObject({ userId, email: "updated@example.com", image: "https://example.com/avatar.png", command: { expectedVersion: BigInt(7) } });
    expect(revalidated).toEqual(["/users", `/users/${userId}`, "/users", `/users/${userId}`]);
  });

  it("WEB-SEC-USER-002 rejects browser-supplied administrator fields and mismatched RPC scope", async () => {
    let calls = 0;
    const revalidated: string[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        createUser: () => {
          calls += 1;
          return { user: user("active"), replayed: false };
        },
      });
    });
    const handle = createUserActionHandler({ loadClient: async () => createIamManagementClient(transport), revalidatePath: (path) => revalidated.push(path) });

    const injected = await handle({ operation: "create", email: "new@example.com", name: "New User", requestId, commandId, reason: "Provision", platformRole: "admin" } as never);
    expect(injected).toMatchObject({ status: "error", kind: "invalid", commandId });
    expect(calls).toBe(0);

    const mismatch = await handle({ operation: "create", email: "new@example.com", name: "New User", requestId, commandId, reason: "Provision" });
    expect(mismatch).toMatchObject({ status: "error", kind: "internal", commandId });
    expect(revalidated).toEqual([]);
  });

  it("WEB-INT-USER-001 executes every lifecycle command with expected version and stable replay identity", async () => {
    const calls: Array<Readonly<{ operation: string; commandId: string; expectedVersion?: bigint }>> = [];
    const events: Array<ReturnType<typeof securityEvent>> = [];
    const seen = new Set<string>();
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        suspendUser: (request) => mutation("suspend", "suspended", request.command),
        reactivateUser: (request) => mutation("reactivate", "active", request.command),
        deleteUser: (request) => mutation("delete", "deleted", request.command),
        restoreUser: (request) => mutation("restore", "active", request.command),
        listSecurityEvents: () => ({ events, page: { nextCursor: "" }, statistics: { total: BigInt(events.length), byKind: [] } }),
      });
    });
    const revalidated: string[] = [];
    const client = createIamManagementClient(transport);
    const handle = createUserActionHandler({ loadClient: async () => client, revalidatePath: (path) => revalidated.push(path) });

    for (const operation of ["suspend", "reactivate", "delete", "restore"] as const) {
      const result = await handle({
        operation,
        userId,
        requestId,
        commandId,
        reason: "Security review",
        expectedVersion: "7",
      });
      expect(result.status).toBe("success");
    }
    const replay = await handle({
      operation: "suspend",
      userId,
      requestId,
      commandId,
      reason: "Security review",
      expectedVersion: "7",
    });

    expect(replay).toEqual({ status: "success", commandId, replayed: true });
    expect(calls).toHaveLength(5);
    expect(calls.every((call) => call.commandId === commandId && call.expectedVersion === BigInt(7))).toBe(true);
    expect(revalidated).toContain("/users");
    expect(revalidated).toContain(`/users/${userId}`);
    const correlated = await client.listSecurityEvents({ requestId, targetUserId: userId, limit: 25 });
    expect(correlated.items.every((event) => event.commandId === commandId && event.targetUserId === userId)).toBe(true);
    expect(toJsonString(SecurityEventRecordSchema, events[0])).not.toContain("Security review");

    function mutation(
      operation: string,
      status: "active" | "suspended" | "deleted",
      value: CommandContext | undefined,
    ) {
      const command = value ?? missingCommand();
      calls.push({ operation, commandId: command.commandId, expectedVersion: command.expectedVersion });
      const replayed = seen.has(`${operation}:${command.commandId}`);
      seen.add(`${operation}:${command.commandId}`);
      events.push(securityEvent(operation, command.commandId));
      return { user: user(status), replayed };
    }
  });

  it("WEB-INT-USER-001 loads deleted detail explicitly and returns null for a missing User", async () => {
    const includeDeleted: boolean[] = [];
    const missingId = "f7a311f0-da05-402c-bf2f-b85a14db5864";
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        getUser: (request) => {
          includeDeleted.push(request.includeDeleted);
          return request.userId === missingId ? {} : { user: user("deleted") };
        },
        listSecurityEvents: () => ({ events: [], page: { nextCursor: "" }, statistics: { total: BigInt(0), byKind: [] } }),
      });
      router.service(IamSessionService, {
        listSessions: () => ({ sessions: [], page: { nextCursor: "" } }),
      });
    });
    const client = createIamManagementClient(transport);

    expect(await loadUserDetail(client, userId)).toMatchObject({ user: { id: userId, status: "deleted" } });
    expect(await loadUserDetail(client, missingId)).toBeNull();
    expect(includeDeleted).toEqual([true, true]);
  });

  it("WEB-INT-USER-001 returns a safe in-progress result with the same command ID", async () => {
    const marker = "RAW_UPSTREAM_SECRET";
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        suspendUser: () => {
          const detail = create(ErrorDetailSchema, {
            reason: "command_in_progress",
            requestId,
            field: "command_id",
          });
          throw new ConnectError(marker, Code.Aborted, undefined, [{ desc: ErrorDetailSchema, value: detail }]);
        },
      });
    });
    const handle = createUserActionHandler({
      loadClient: async () => createIamManagementClient(transport),
      revalidatePath: () => undefined,
    });
    const result = await handle({
      operation: "suspend",
      userId,
      requestId,
      commandId,
      reason: "Security review",
      expectedVersion: "7",
    });

    expect(result).toEqual({
      status: "error",
      commandId,
      kind: "in_progress",
      requestId,
      field: "command_id",
    });
    expect(JSON.stringify(result)).not.toContain(marker);
  });
});

function missingCommand(): never {
  throw new Error("command required");
}

function user(status: "active" | "suspended" | "deleted") {
  return create(UserRecordSchema, {
    id: userId,
    email: "admin@example.com",
    name: "Admin",
    platformRole: "admin",
    status,
    version: BigInt(8),
    ...(status === "deleted" ? { deletedAt: timestampFromDate(now) } : {}),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}

function standardUser(email: string, name: string) {
  return create(UserRecordSchema, {
    id: userId,
    email,
    name,
    platformRole: "user",
    status: "active",
    version: BigInt(8),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}

function securityEvent(kind: string, eventCommandId: string) {
  return create(SecurityEventRecordSchema, {
    id: "a237ca85-0634-4ce8-bd37-6d7bd90beaa8",
    kind: `user.${kind}`,
    actorUserId: userId,
    targetUserId: userId,
    requestId,
    commandId: eventCommandId,
    metadataJson: "{}",
    createdAt: timestampFromDate(now),
  });
}
