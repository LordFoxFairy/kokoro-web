import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ErrorDetailSchema } from "../../generated/iam/proto/kokoro/common/v1/error_pb";
import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { IamAuthorizationService } from "../../generated/iam/proto/kokoro/iam/v1/authorization_pb";
import { IamOrganizationService } from "../../generated/iam/proto/kokoro/iam/v1/organization_pb";
import {
  MemberRecordSchema,
  OrganizationRecordSchema,
  RoleRecordSchema,
  SecurityEventRecordSchema,
  UserRecordSchema,
  type CommandContext,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { createOrganizationActionHandler } from "../../modules/iam/organizations/actions";
import { loadOrganizationDetail, loadOrganizations } from "../../modules/iam/organizations/query";
import { createIamManagementClient } from "../../server/iam/management-client";

const organizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const memberId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const commandId = "df486566-7614-461f-a72c-1b3d4ea9e985";
const now = new Date("2026-08-16T10:00:00.000Z");

describe("IAM Organization queries and server actions", () => {
  it("WEB-INT-ORG-001 executes create update delete restore and stable replay through generated RPC", async () => {
    const calls: Array<Readonly<{ operation: string; commandId: string; expectedVersion?: bigint }>> = [];
    const seen = new Set<string>();
    const transport = createRouterTransport((router) => {
      router.service(IamOrganizationService, {
        createOrganization: (request) => mutation("create", "active", request.command),
        updateOrganization: (request) => mutation("update", "active", request.command),
        deleteOrganization: (request) => mutation("delete", "deleted", request.command),
        restoreOrganization: (request) => mutation("restore", "active", request.command),
      });
    });
    const revalidated: string[] = [];
    const actorScopes: Array<string | undefined> = [];
    const handle = createOrganizationActionHandler({
      loadClient: async (...args: unknown[]) => {
        actorScopes.push(typeof args[0] === "string" ? args[0] : undefined);
        return createIamManagementClient(transport);
      },
      revalidatePath: (path) => revalidated.push(path),
    });

    const createInput = {
      operation: "create" as const,
      slug: "kokoro-labs",
      name: "Kokoro Labs",
      requestId,
      commandId,
      reason: "Tenant onboarding",
    };
    expect(await handle(createInput)).toEqual({ status: "success", commandId, replayed: false });
    expect(await handle(createInput)).toEqual({ status: "success", commandId, replayed: true });

    for (const operation of ["update", "delete", "restore"] as const) {
      const identity = {
        organizationId,
        requestId,
        commandId: crypto.randomUUID(),
        reason: "Lifecycle review",
        expectedVersion: "7",
      };
      const result = operation === "update"
        ? await handle({ ...identity, operation, name: "Kokoro Platform" })
        : await handle({ ...identity, operation });
      expect(result.status).toBe("success");
    }

    expect(calls[0]).toEqual({ operation: "create", commandId, expectedVersion: undefined });
    expect(calls[1]).toEqual({ operation: "create", commandId, expectedVersion: undefined });
    expect(calls.slice(2).every((call) => call.expectedVersion === BigInt(7))).toBe(true);
    expect(revalidated).toContain("/organizations");
    expect(revalidated).toContain(`/organizations/${organizationId}`);
    expect(actorScopes).toEqual([undefined, undefined, undefined, undefined, undefined]);

    function mutation(operation: string, status: "active" | "deleted", value: CommandContext | undefined) {
      const command = value ?? missingCommand();
      calls.push({ operation, commandId: command.commandId, expectedVersion: command.expectedVersion });
      const key = `${operation}:${command.commandId}`;
      const replayed = seen.has(key);
      seen.add(key);
      return { organization: organization(status), replayed };
    }
  });

  it("WEB-INT-ORG-001 loads filtered Organizations and complete deleted detail with active User lookup", async () => {
    const observed: Record<string, unknown>[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        listOrganizations: (request) => {
          observed.push({ method: "listOrganizations", ...request });
          return { organizations: [organization("deleted")], page: { nextCursor: "next/cursor" } };
        },
        listUsers: (request) => {
          observed.push({ method: "listUsers", ...request });
          return { users: [user()], page: { nextCursor: "" } };
        },
        listSecurityEvents: (request) => {
          observed.push({ method: "listSecurityEvents", ...request });
          return { events: [securityEvent()], page: { nextCursor: "" } };
        },
      });
      router.service(IamOrganizationService, {
        getOrganization: (request) => {
          observed.push({ method: "getOrganization", ...request });
          return { organization: organization("deleted") };
        },
        listMembers: (request) => {
          observed.push({ method: "listMembers", ...request });
          return { members: [member()], page: { nextCursor: "" } };
        },
      });
      router.service(IamAuthorizationService, {
        listRoleCatalog: (request) => {
          observed.push({ method: "listRoleCatalog", ...request });
          return { roles: [role()] };
        },
      });
    });
    const client = createIamManagementClient(transport);

    const list = await loadOrganizations(client, {
      query: " kokoro ",
      status: "deleted",
      includeDeleted: "true",
      cursor: "opaque/cursor",
      limit: "999",
    });
    const detail = await loadOrganizationDetail(client, organizationId, {
      memberQuery: " admin@example.com ",
      includeDeletedMembers: "true",
    });

    expect(list).toMatchObject({
      items: [{ id: organizationId, status: "deleted" }],
      nextCursor: "next/cursor",
      filters: { query: "kokoro", status: "deleted", includeDeleted: true, cursor: "opaque/cursor", limit: 100 },
    });
    expect(detail).toMatchObject({
      organization: { id: organizationId, status: "deleted" },
      members: {
        items: [{ id: memberId, userLabel: "admin@example.com" }],
        roleOptions: [{ key: "owner", builtIn: true }],
        userOptions: [{ id: userId, email: "admin@example.com" }],
      },
      events: [{ organizationId }],
    });
    expect(observed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "listOrganizations",
        query: "kokoro",
        status: "deleted",
        includeDeleted: true,
        page: expect.objectContaining({ limit: 100, cursor: "opaque/cursor" }),
      }),
      expect.objectContaining({ method: "getOrganization", organizationId, includeDeleted: true }),
      expect.objectContaining({ method: "listMembers", organizationId, includeDeleted: true }),
      expect.objectContaining({ method: "listUsers", query: "admin@example.com", status: "active", includeDeleted: false }),
      expect.objectContaining({ method: "listRoleCatalog", organizationId }),
      expect.objectContaining({ method: "listSecurityEvents", organizationId }),
    ]));
  });

  it("WEB-INT-ORG-001 rejects invalid names locally and preserves a safe restore conflict", async () => {
    let calls = 0;
    const marker = "RAW_RESTORE_CONFLICT";
    const transport = createRouterTransport((router) => {
      router.service(IamOrganizationService, {
        createOrganization: () => {
          calls += 1;
          return { organization: organization("active"), replayed: false };
        },
        restoreOrganization: () => {
          calls += 1;
          const detail = create(ErrorDetailSchema, { reason: "conflict", requestId, field: "slug" });
          throw new ConnectError(marker, Code.AlreadyExists, undefined, [{ desc: ErrorDetailSchema, value: detail }]);
        },
      });
    });
    const handle = createOrganizationActionHandler({
      loadClient: async () => createIamManagementClient(transport),
      revalidatePath: () => undefined,
    });

    expect(await handle({
      operation: "create",
      slug: "Invalid Slug",
      name: " ",
      requestId,
      commandId,
      reason: "Tenant onboarding",
    })).toEqual({ status: "error", commandId, kind: "invalid", requestId });
    expect(calls).toBe(0);

    const result = await handle({
      operation: "restore",
      organizationId,
      requestId,
      commandId,
      reason: "Restore tenant",
      expectedVersion: "8",
    });
    expect(result).toEqual({ status: "error", commandId, kind: "conflict", requestId, field: "slug" });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(calls).toBe(1);
  });
});

function missingCommand(): never {
  throw new Error("command required");
}

function organization(status: "active" | "deleted") {
  return create(OrganizationRecordSchema, {
    id: organizationId,
    slug: "kokoro-labs",
    name: "Kokoro Labs",
    status,
    version: BigInt(7),
    ...(status === "deleted" ? { deletedAt: timestampFromDate(now) } : {}),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}

function member() {
  return create(MemberRecordSchema, {
    id: memberId,
    organizationId,
    userId,
    roleId: "4f7556a0-64ea-4da0-8996-d1f744035b75",
    roleKey: "owner",
    status: "active",
    version: BigInt(3),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}

function role() {
  return create(RoleRecordSchema, {
    id: "4f7556a0-64ea-4da0-8996-d1f744035b75",
    organizationId,
    key: "owner",
    name: "Owner",
    description: "Full control",
    builtIn: true,
    status: "active",
    version: BigInt(2),
    permissionKeys: ["organization:delete"],
  });
}

function user() {
  return create(UserRecordSchema, {
    id: userId,
    email: "admin@example.com",
    name: "Admin",
    platformRole: "admin",
    status: "active",
    version: BigInt(5),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}

function securityEvent() {
  return create(SecurityEventRecordSchema, {
    id: "3598c32a-c62b-4803-92c2-b5baaf507d9f",
    kind: "organization.deleted",
    organizationId,
    requestId,
    commandId,
    metadataJson: "{}",
    createdAt: timestampFromDate(now),
  });
}
