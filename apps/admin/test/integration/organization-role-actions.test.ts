import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { IamAuthorizationService } from "../../generated/iam/proto/kokoro/iam/v1/authorization_pb";
import { IamOrganizationService } from "../../generated/iam/proto/kokoro/iam/v1/organization_pb";
import {
  OrganizationRecordSchema, PermissionRecordSchema, RoleRecordSchema, type CommandContext,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { loadOrganizationDetail } from "../../modules/iam/organizations/query";
import { createOrganizationRoleActionHandler } from "../../modules/iam/roles/actions";
import type { OrganizationRoleCommandActionInput } from "../../modules/iam/roles/schema";
import { createIamManagementClient } from "../../server/iam/management-client";

const organizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const customRoleId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const builtInRoleId = "4f7556a0-64ea-4da0-8996-d1f744035b75";
const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const now = new Date("2026-08-17T10:00:00.000Z");

describe("Organization custom Roles", () => {
  it("WEB-INT-ROLE-001 loads authoritative roles, active member options and permissions grouped by resource", async () => {
    const observed: Record<string, unknown>[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamOrganizationService, {
        getOrganization: () => ({ organization: organization() }),
        listMembers: () => ({ members: [], page: {} }),
        listOrganizationRoles: (request) => {
          observed.push({ method: "listOrganizationRoles", ...request });
          return { roles: [role(customRoleId, "auditor", false, "active"), role(builtInRoleId, "owner", true, "active"), role("d084ca25-9e77-48b6-a1ed-727fd588f35e", "retired_auditor", false, "deleted")] };
        },
      });
      router.service(IamAuthorizationService, {
        listPermissionCatalog: () => ({ permissions: [
          permission("organization:read", "organization", "read"),
          permission("organization:update", "organization", "update"),
          permission("member:read", "member", "read"),
        ] }),
      });
      router.service(IamAdministrationService, {
        listUsers: () => ({ users: [], page: {} }),
        listSecurityEvents: () => ({ events: [], page: {}, statistics: { total: BigInt(0), byKind: [] } }),
      });
    });

    const detail = await loadOrganizationDetail(createIamManagementClient(transport), organizationId);

    expect(detail).toMatchObject({
      members: { roleOptions: [{ key: "auditor" }, { key: "owner" }] },
      roles: {
        items: [
          { id: customRoleId, key: "auditor", builtIn: false, status: "active" },
          { id: builtInRoleId, key: "owner", builtIn: true, status: "active" },
          { key: "retired_auditor", status: "deleted" },
        ],
        permissionGroups: [
          { resource: "member", permissions: [{ key: "member:read" }] },
          { resource: "organization", permissions: [{ key: "organization:read" }, { key: "organization:update" }] },
        ],
      },
    });
    expect(observed).toContainEqual(expect.objectContaining({
      method: "listOrganizationRoles", organizationId, includeDeleted: true,
    }));
  });

  it("WEB-INT-ROLE-001 executes custom Role CRUD and complete permission replacement", async () => {
    const calls: Array<Readonly<{ operation: string; expectedVersion?: bigint; permissions?: readonly string[] }>> = [];
    const transport = createRouterTransport((router) => {
      router.service(IamOrganizationService, {
        listOrganizationRoles: () => ({ roles: [role(customRoleId, "auditor", false, "active")] }),
        createOrganizationRole: (request) => mutation("create", request.command, request.permissionKeys),
        updateOrganizationRole: (request) => mutation("update", request.command),
        deleteOrganizationRole: (request) => mutation("delete", request.command, undefined, "deleted"),
        restoreOrganizationRole: (request) => mutation("restore", request.command),
        setOrganizationRolePermissions: (request) => mutation("set-permissions", request.command, request.permissionKeys),
      });
    });
    const revalidated: string[] = [];
    const handle = createOrganizationRoleActionHandler({
      loadClient: async () => createIamManagementClient(transport),
      revalidatePath: (path) => revalidated.push(path),
    });
    const commands: OrganizationRoleCommandActionInput[] = [
      { operation: "create", organizationId, key: "auditor", name: "Auditor", description: "Read-only review", permissionKeys: ["member:read", "organization:read"], ...identity(1) },
      { operation: "update", organizationId, roleId: customRoleId, name: "Senior Auditor", description: "Expanded review", expectedVersion: "2", ...identity(2) },
      { operation: "set-permissions", organizationId, roleId: customRoleId, permissionKeys: ["organization:update", "organization:read"], expectedVersion: "3", ...identity(3) },
      { operation: "delete", organizationId, roleId: customRoleId, expectedVersion: "4", ...identity(4) },
      { operation: "restore", organizationId, roleId: customRoleId, expectedVersion: "5", ...identity(5) },
    ];

    for (const input of commands) expect(await handle(input), input.operation).toMatchObject({ status: "success" });

    expect(calls).toEqual([
      { operation: "create", expectedVersion: undefined, permissions: ["member:read", "organization:read"] },
      { operation: "update", expectedVersion: BigInt(2) },
      { operation: "set-permissions", expectedVersion: BigInt(3), permissions: ["organization:read", "organization:update"] },
      { operation: "delete", expectedVersion: BigInt(4) },
      { operation: "restore", expectedVersion: BigInt(5) },
    ]);
    expect(revalidated).toEqual(Array.from({ length: 5 }, () => `/organizations/${organizationId}`));

    function mutation(operation: string, value: CommandContext | undefined, permissions?: readonly string[], status: "active" | "deleted" = "active") {
      const command = value ?? missingCommand();
      calls.push({ operation, expectedVersion: command.expectedVersion, ...(permissions === undefined ? {} : { permissions }) });
      return { role: role(customRoleId, "auditor", false, status, permissions), replayed: false };
    }
  });

  it("WEB-SEC-ROLE-001 rejects built-in Role mutation before invoking the mutation RPC", async () => {
    let mutationCalls = 0;
    const transport = createRouterTransport((router) => {
      router.service(IamOrganizationService, {
        listOrganizationRoles: () => ({ roles: [role(builtInRoleId, "owner", true, "active")] }),
        updateOrganizationRole: () => { mutationCalls += 1; return { role: role(builtInRoleId, "owner", true, "active") }; },
      });
    });
    const handle = createOrganizationRoleActionHandler({
      loadClient: async () => createIamManagementClient(transport),
      revalidatePath: () => undefined,
    });

    expect(await handle({
      operation: "update", organizationId, roleId: builtInRoleId, name: "Changed", description: "Forbidden",
      expectedVersion: "1", ...identity(7),
    })).toEqual(expect.objectContaining({ status: "error", kind: "forbidden" }));
    expect(mutationCalls).toBe(0);
  });
});

function identity(index: number) {
  return {
    requestId,
    commandId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    reason: "Role governance review",
  };
}

function missingCommand(): never { throw new Error("command required"); }

function organization() {
  return create(OrganizationRecordSchema, {
    id: organizationId, slug: "kokoro-labs", name: "Kokoro Labs", status: "active", version: BigInt(1),
    createdAt: timestampFromDate(now), updatedAt: timestampFromDate(now),
  });
}

function role(id: string, key: string, builtIn: boolean, status: "active" | "deleted", permissions: readonly string[] = ["organization:read"]) {
  return create(RoleRecordSchema, {
    id, organizationId, key, name: key, description: `${key} description`, builtIn, status, version: BigInt(1),
    permissionKeys: [...permissions],
  });
}

function permission(key: string, resource: string, action: string) {
  return create(PermissionRecordSchema, {
    id: crypto.randomUUID(), key, resource, action, description: `${key} permission`, status: "active",
  });
}
