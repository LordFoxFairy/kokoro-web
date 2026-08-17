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
  SecurityEventRecordSchema,
  UserRecordSchema,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { loadAccess } from "../../modules/iam/access/query";
import { createMemberActionHandler } from "../../modules/iam/members/actions";
import { createOrganizationActionHandler } from "../../modules/iam/organizations/actions";
import { loadOrganizationDetail } from "../../modules/iam/organizations/query";
import { createIamManagementClient } from "../../server/iam/management-client";

const organizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const foreignMemberId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const commandId = "df486566-7614-461f-a72c-1b3d4ea9e985";
const foreignOrganizationId = "21ec9d0b-429e-473b-b41b-8b52a91ca5d3";
const now = new Date("2026-08-16T10:00:00.000Z");

describe("IAM tenant isolation", () => {
  it("WEB-SEC-TENANT-001 detects a foreign Member response and refuses authoritative revalidation", async () => {
    const revalidated: string[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamOrganizationService, {
        changeMemberRole: () => ({
          member: create(MemberRecordSchema, {
            id: foreignMemberId,
            organizationId: foreignOrganizationId,
            userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
            roleId: "4f7556a0-64ea-4da0-8996-d1f744035b75",
            roleKey: "member",
            status: "active",
            version: BigInt(2),
            createdAt: timestampFromDate(now),
            updatedAt: timestampFromDate(now),
          }),
          replayed: false,
        }),
      });
    });
    const handle = createMemberActionHandler({
      loadClient: async () => createIamManagementClient(transport),
      revalidatePath: (path) => revalidated.push(path),
    });

    const result = await handle({
      operation: "change-role",
      organizationId,
      memberId: foreignMemberId,
      roleKey: "member",
      requestId,
      commandId,
      reason: "Access review",
      expectedVersion: "1",
    });

    expect(result).toEqual({ status: "error", commandId, kind: "internal", requestId: "" });
    expect(revalidated).toEqual([]);
  });

  it("WEB-SEC-TENANT-001 rejects a successful Organization command response for another target", async () => {
    const revalidated: string[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamOrganizationService, {
        updateOrganization: () => ({ organization: foreignOrganization(), replayed: false }),
      });
    });
    const handle = createOrganizationActionHandler({
      loadClient: async () => createIamManagementClient(transport),
      revalidatePath: (path) => revalidated.push(path),
    });

    const result = await handle({
      operation: "update",
      organizationId,
      name: "Kokoro Platform",
      requestId,
      commandId,
      reason: "Tenant rename",
      expectedVersion: "1",
    });

    expect(result).toEqual({ status: "error", commandId, kind: "internal", requestId: "" });
    expect(revalidated).toEqual([]);
  });

  it("WEB-SEC-TENANT-001 rejects cross-organization records at the Web view-model boundary", async () => {
    let scope: "organization" | "member" | "event" | "role" | "decision" = "organization";
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        listOrganizations: () => ({ organizations: [localOrganization()], page: { nextCursor: "" } }),
        listUsers: () => ({ users: [localUser()], page: { nextCursor: "" } }),
        listSecurityEvents: () => ({
          events: scope === "event" ? [create(SecurityEventRecordSchema, {
            id: "3598c32a-c62b-4803-92c2-b5baaf507d9f",
            kind: "member.changed",
            organizationId: foreignOrganizationId,
            requestId,
            metadataJson: "{}",
            createdAt: timestampFromDate(now),
          })] : [],
          page: { nextCursor: "" },
          statistics: { total: BigInt(scope === "event" ? 1 : 0), byKind: [] },
        }),
      });
      router.service(IamOrganizationService, {
        getOrganization: () => ({ organization: scope === "organization" ? foreignOrganization() : localOrganization() }),
        listMembers: () => ({
          members: scope === "member" ? [create(MemberRecordSchema, {
            id: foreignMemberId,
            organizationId: foreignOrganizationId,
            userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
            roleId: "4f7556a0-64ea-4da0-8996-d1f744035b75",
            roleKey: "owner",
            status: "active",
            version: BigInt(1),
            createdAt: timestampFromDate(now),
            updatedAt: timestampFromDate(now),
          })] : [],
          page: { nextCursor: "" },
        }),
        listOrganizationRoles: () => ({ roles: scope === "role" ? [foreignRole()] : [] }),
      });
      router.service(IamAuthorizationService, {
        listRoleCatalog: () => ({ roles: scope === "role" ? [foreignRole()] : [] }),
        listPermissionCatalog: () => ({ permissions: scope === "decision" ? [organizationDeletePermission()] : [] }),
        inspectUserAuthorization: () => ({
          allowed: false,
          reasonCode: "permission_denied",
          userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
          organizationId: foreignOrganizationId,
          roleKeys: ["member"],
          authorizationVersion: BigInt(2),
          evaluatedAt: timestampFromDate(now),
        }),
      });
    });
    const client = createIamManagementClient(transport);

    await expect(loadOrganizationDetail(client, organizationId)).rejects.toThrow("invalid organization scope");
    scope = "member";
    await expect(loadOrganizationDetail(client, organizationId)).rejects.toThrow("invalid organization member scope");
    scope = "event";
    await expect(loadOrganizationDetail(client, organizationId)).rejects.toThrow("invalid organization event scope");
    scope = "role";
    await expect(loadOrganizationDetail(client, organizationId)).rejects.toThrow("invalid organization role scope");
    await expect(loadAccess(client, { organizationId })).rejects.toThrow("invalid access role scope");
    scope = "decision";
    await expect(loadAccess(client, {
      organizationId,
      userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
      permissionKey: "organization:delete",
    }))
      .rejects.toThrow("invalid access decision scope");
  });
});

function foreignRole() {
  return create(RoleRecordSchema, {
    id: "4f7556a0-64ea-4da0-8996-d1f744035b75",
    organizationId: foreignOrganizationId,
    key: "owner",
    name: "Owner",
    description: "Full control",
    builtIn: true,
    status: "active",
    version: BigInt(1),
    permissionKeys: ["organization:delete"],
  });
}

function localOrganization() {
  return create(OrganizationRecordSchema, {
    id: organizationId,
    slug: "kokoro-labs",
    name: "Kokoro Labs",
    status: "active",
    version: BigInt(1),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}

function foreignOrganization() {
  return create(OrganizationRecordSchema, {
    id: foreignOrganizationId,
    slug: "foreign-tenant",
    name: "Foreign Tenant",
    status: "active",
    version: BigInt(1),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}

function organizationDeletePermission() {
  return create(PermissionRecordSchema, {
    id: "c1e86637-64e3-469e-8a47-c4429f55f1d3",
    key: "organization:delete",
    resource: "organization",
    action: "delete",
    description: "Soft delete an organization.",
    status: "active",
  });
}

function localUser() {
  return create(UserRecordSchema, {
    id: "bce7762a-f7c7-4d22-8031-4336803038eb",
    email: "member@example.com",
    name: "Member",
    platformRole: "user",
    status: "active",
    version: BigInt(1),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}
