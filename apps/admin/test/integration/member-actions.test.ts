import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { IamAuthorizationService } from "../../generated/iam/proto/kokoro/iam/v1/authorization_pb";
import { IamOrganizationService } from "../../generated/iam/proto/kokoro/iam/v1/organization_pb";
import {
  MemberRecordSchema,
  OrganizationRecordSchema,
  PermissionRecordSchema,
  RoleRecordSchema,
  UserRecordSchema,
  type CommandContext,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { loadAccess } from "../../modules/iam/access/query";
import { createMemberActionHandler } from "../../modules/iam/members/actions";
import type { MemberCommandActionInput } from "../../modules/iam/members/schema";
import { createIamManagementClient } from "../../server/iam/management-client";

const organizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const memberId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const requestIds = [
  "8deecb20-8d72-4b7e-a719-722a2e606728",
  "df486566-7614-461f-a72c-1b3d4ea9e985",
  "0dbc85ab-70fb-4362-8854-e4834be725ec",
  "e0e3e8fc-b867-45e3-bcc9-4942c1a51985",
  "c1e86637-64e3-469e-8a47-c4429f55f1d3",
  "750ac919-3347-42f8-a824-3a13d3f99934",
  "31f20ae3-4f53-47ad-8884-c83ecb61dca6",
] as const;
const now = new Date("2026-08-16T10:00:00.000Z");

describe("IAM Member commands and Access reads", () => {
  it("WEB-INT-MEMBER-001 executes the complete lifecycle through generated commands", async () => {
    let status: "active" | "suspended" | "deleted" = "active";
    let roleKey = "owner";
    const calls: Array<Readonly<{ operation: string; organizationId: string; expectedVersion?: bigint }>> = [];
    const transport = createRouterTransport((router) => {
      router.service(IamOrganizationService, {
        addMember: (request) => mutate("add", request.organizationId, request.command, "active", request.roleKey),
        changeMemberRole: (request) => mutate("change-role", request.organizationId, request.command, status, request.roleKey),
        suspendMember: (request) => mutate("suspend", request.organizationId, request.command, "suspended", roleKey),
        reactivateMember: (request) => mutate("reactivate", request.organizationId, request.command, "active", roleKey),
        removeMember: (request) => mutate("remove", request.organizationId, request.command, "deleted", roleKey),
        restoreMember: (request) => mutate("restore", request.organizationId, request.command, "active", roleKey),
      });
    });
    const client = createIamManagementClient(transport);
    const revalidated: string[] = [];
    const actorScopes: Array<string | undefined> = [];
    const handle = createMemberActionHandler({
      loadClient: async (...args: unknown[]) => {
        actorScopes.push(typeof args[0] === "string" ? args[0] : undefined);
        return client;
      },
      revalidatePath: (path) => revalidated.push(path),
    });

    await execute({ ...identity(0), operation: "add", userId, roleKey: "owner" });
    await execute({ ...identity(1), operation: "change-role", memberId, roleKey: "member", expectedVersion: "3" });
    await execute({ ...identity(2), operation: "suspend", memberId, expectedVersion: "4" });
    await execute({ ...identity(3), operation: "reactivate", memberId, expectedVersion: "5" });
    await execute({ ...identity(4), operation: "change-role", memberId, roleKey: "owner", expectedVersion: "6" });
    await execute({ ...identity(5), operation: "remove", memberId, expectedVersion: "7" });
    await execute({ ...identity(6), operation: "restore", memberId, expectedVersion: "8" });

    expect(calls).toEqual([
      { operation: "add", organizationId, expectedVersion: undefined },
      { operation: "change-role", organizationId, expectedVersion: BigInt(3) },
      { operation: "suspend", organizationId, expectedVersion: BigInt(4) },
      { operation: "reactivate", organizationId, expectedVersion: BigInt(5) },
      { operation: "change-role", organizationId, expectedVersion: BigInt(6) },
      { operation: "remove", organizationId, expectedVersion: BigInt(7) },
      { operation: "restore", organizationId, expectedVersion: BigInt(8) },
    ]);
    expect(revalidated).toContain(`/organizations/${organizationId}`);
    expect(revalidated).toContain("/access");
    expect(actorScopes).toEqual(Array.from({ length: 7 }, () => undefined));

    function identity(index: number) {
      return {
        organizationId,
        requestId: requestIds[index],
        commandId: crypto.randomUUID(),
        reason: "Membership review",
      };
    }

    async function execute(input: MemberCommandActionInput) {
      const result = await handle(input);
      expect(result.status).toBe("success");
    }

    function mutate(
      operation: string,
      requestOrganizationId: string,
      command: CommandContext | undefined,
      nextStatus: typeof status,
      nextRole: string,
    ) {
      const value = command ?? missingCommand();
      calls.push({ operation, organizationId: requestOrganizationId, expectedVersion: value.expectedVersion });
      status = nextStatus;
      roleKey = nextRole;
      return { member: member(status, roleKey), replayed: false };
    }
  });

  it("WEB-INT-MEMBER-001 inspects the selected User without using an actor Session as the subject", async () => {
    const observed: Record<string, unknown>[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        listOrganizations: () => ({ organizations: [organization(organizationId, "kokoro-labs")], page: {} }),
        listUsers: () => ({ users: [user()], page: {} }),
      });
      router.service(IamAuthorizationService, {
        listPermissionCatalog: () => ({ permissions: [permission()] }),
        listRoleCatalog: () => ({ roles: [role("member")] }),
        inspectUserAuthorization: (request) => {
          observed.push(request);
          return {
            allowed: false,
            reasonCode: "permission_denied",
            userId,
            organizationId,
            roleKeys: ["member"],
            authorizationVersion: BigInt(7),
            evaluatedAt: timestampFromDate(now),
          };
        },
      });
    });

    const view = await loadAccess(createIamManagementClient(transport), {
      organizationId,
      userId,
      permissionKey: "organization:delete",
    });

    expect(observed).toEqual([expect.objectContaining({
      organizationId,
      userId,
      permissionKey: "organization:delete",
    })]);
    expect(view.decision).toEqual(expect.objectContaining({ allowed: false, userId, organizationId }));
    expect(view.decision).not.toHaveProperty("sessionId");
  });

  it("WEB-INT-MEMBER-001 loads only provider-owned built-in Role and Permission catalogs", async () => {
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        listOrganizations: () => ({
          organizations: [organization(organizationId, "kokoro-labs")],
          page: { nextCursor: "" },
        }),
        listUsers: () => ({ users: [], page: { nextCursor: "" } }),
      });
      router.service(IamAuthorizationService, {
        listPermissionCatalog: () => ({ permissions: [permission()] }),
        listRoleCatalog: () => ({ roles: [role("owner"), role("member")] }),
      });
    });
    const client = createIamManagementClient(transport);

    const view = await loadAccess(client, { organizationId });

    expect(view.permissions).toEqual([{
      key: "organization:delete",
      resource: "organization",
      action: "delete",
      description: "Soft delete an organization.",
      status: "active",
    }]);
    expect(view.roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "owner", builtIn: true }),
      expect.objectContaining({ key: "member", builtIn: true }),
    ]));
    expect(view.decision).toBeNull();
  });

  it("WEB-UNIT-PAGE-001 pages Organization choices and retains a selected Organization outside the page", async () => {
    const pageOrganizationId = "21ec9d0b-429e-473b-b41b-8b52a91ca5d3";
    const observed: Record<string, unknown>[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        listOrganizations: (request) => {
          observed.push(request);
          return { organizations: [organization(pageOrganizationId, "page-org")], page: { nextCursor: "next/cursor" } };
        },
        listUsers: () => ({ users: [], page: { nextCursor: "" } }),
      });
      router.service(IamOrganizationService, {
        getOrganization: () => ({ organization: organization(organizationId, "selected-org") }),
      });
      router.service(IamAuthorizationService, {
        listPermissionCatalog: () => ({ permissions: [] }),
        listRoleCatalog: () => ({ roles: [] }),
      });
    });

    const view = await loadAccess(createIamManagementClient(transport), {
      organizationId,
      organizationQuery: "selected",
      organizationCursor: "current/cursor",
      organizationLimit: "25",
    });

    expect(observed).toEqual([expect.objectContaining({
      query: "selected",
      status: "active",
      includeDeleted: false,
      page: expect.objectContaining({ cursor: "current/cursor", limit: 25 }),
    })]);
    expect(view.nextOrganizationCursor).toBe("next/cursor");
    expect(view.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: pageOrganizationId }),
      expect.objectContaining({ id: organizationId, slug: "selected-org" }),
    ]));
  });
});

function missingCommand(): never {
  throw new Error("command required");
}

function member(status: "active" | "suspended" | "deleted", roleKey: string) {
  return create(MemberRecordSchema, {
    id: memberId,
    organizationId,
    userId,
    roleId: roleKey === "owner"
      ? "4f7556a0-64ea-4da0-8996-d1f744035b75"
      : "7686b976-4cc6-42c8-9f66-97f5a1bd46cc",
    roleKey,
    status,
    version: BigInt(3),
    ...(status === "deleted" ? { deletedAt: timestampFromDate(now) } : {}),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}

function role(key: "owner" | "member") {
  return create(RoleRecordSchema, {
    id: key === "owner"
      ? "4f7556a0-64ea-4da0-8996-d1f744035b75"
      : "7686b976-4cc6-42c8-9f66-97f5a1bd46cc",
    organizationId,
    key,
    name: key === "owner" ? "Owner" : "Member",
    description: key === "owner" ? "Full control" : "Read access",
    builtIn: true,
    status: "active",
    version: BigInt(2),
    permissionKeys: [key === "owner" ? "organization:delete" : "organization:read"],
  });
}

function permission() {
  return create(PermissionRecordSchema, {
    id: "21ec9d0b-429e-473b-b41b-8b52a91ca5d3",
    key: "organization:delete",
    resource: "organization",
    action: "delete",
    description: "Soft delete an organization.",
    status: "active",
  });
}

function user() {
  return create(UserRecordSchema, {
    id: userId,
    email: "member@example.com",
    name: "Selected Member",
    platformRole: "user",
    status: "active",
    version: BigInt(1),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}

function organization(id: string, slug: string) {
  return create(OrganizationRecordSchema, {
    id,
    slug,
    name: slug,
    status: "active",
    version: BigInt(1),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}
