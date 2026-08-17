import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { IamOrganizationService } from "../../generated/iam/proto/kokoro/iam/v1/organization_pb";
import { IamSiteService } from "../../generated/iam/proto/kokoro/iam/v1/site_pb";
import { RoleRecordSchema, SiteRoleRecordSchema, UserRecordSchema } from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { createIamManagementClient } from "../../server/iam/management-client";

const requestId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const commandId = "b9d876d1-f22a-4cd6-9723-cfbd344ebccb";
const organizationId = "4f7556a0-64ea-4da0-8996-d1f744035b75";
const siteId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const roleId = "21ec9d0b-429e-473b-b41b-8b52a91ca5d3";
const now = timestampFromDate(new Date("2026-08-17T12:00:00.000Z"));
const command = { requestId, commandId, reason: "RBAC test", expectedVersion: BigInt(1) };

describe("IAM management client user and custom-role RPC base", () => {
  it("WEB-UNIT-RPC-001 forwards User filters/mutations and maps scoped custom roles", async () => {
    const calls: string[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        listUsers: (request) => {
          expect(request.platformRole).toBe("user");
          return { users: [], page: { nextCursor: "" } };
        },
        createUser: (request) => ({ user: user(request.email, request.name), replayed: false }),
        updateUser: (request) => ({ user: user(request.email, request.name), replayed: true }),
      });
      router.service(IamOrganizationService, {
        listOrganizationRoles: () => ({ roles: [organizationRole()] }),
        createOrganizationRole: () => (calls.push("organization.create"), { role: organizationRole(), replayed: false }),
        updateOrganizationRole: () => (calls.push("organization.update"), { role: organizationRole(), replayed: false }),
        deleteOrganizationRole: () => (calls.push("organization.delete"), { role: organizationRole(), replayed: false }),
        restoreOrganizationRole: () => (calls.push("organization.restore"), { role: organizationRole(), replayed: false }),
        setOrganizationRolePermissions: () => (calls.push("organization.permissions"), { role: organizationRole(), replayed: false }),
      });
      router.service(IamSiteService, {
        listSiteRoles: () => ({ roles: [siteRole()] }),
        createSiteRole: () => (calls.push("site.create"), { role: siteRole(), replayed: false }),
        updateSiteRole: () => (calls.push("site.update"), { role: siteRole(), replayed: false }),
        deleteSiteRole: () => (calls.push("site.delete"), { role: siteRole(), replayed: false }),
        restoreSiteRole: () => (calls.push("site.restore"), { role: siteRole(), replayed: false }),
        setSiteRolePermissions: () => (calls.push("site.permissions"), { role: siteRole(), replayed: false }),
      });
    });
    const client = createIamManagementClient(transport);

    await client.listUsers({ requestId, query: "", platformRole: "user", includeDeleted: false, limit: 20 });
    expect((await client.createUser(command, "new@example.com", "New User")).value.platformRole).toBe("user");
    expect((await client.updateUser(command, requestId, "next@example.com", "Next User")).replayed).toBe(true);
    expect((await client.listOrganizationRoles({ requestId, organizationId, includeDeleted: true }))[0]?.key).toBe("billing_reviewer");
    expect((await client.listSiteRoles({ requestId, siteId, includeDeleted: true }))[0]?.key).toBe("content_editor");

    await client.createOrganizationRole(command, organizationId, "billing_reviewer", "Billing reviewer", "Reviews billing", ["billing:read"]);
    await client.updateOrganizationRole(command, organizationId, roleId, "Reviewer", "Reviews billing");
    await client.deleteOrganizationRole(command, organizationId, roleId);
    await client.restoreOrganizationRole(command, organizationId, roleId);
    await client.setOrganizationRolePermissions(command, organizationId, roleId, ["billing:read"]);
    await client.createSiteRole(command, siteId, "content_editor", "Content editor", "Edits content", ["site:update"]);
    await client.updateSiteRole(command, siteId, roleId, "Editor", "Edits content");
    await client.deleteSiteRole(command, siteId, roleId);
    await client.restoreSiteRole(command, siteId, roleId);
    await client.setSiteRolePermissions(command, siteId, roleId, ["site:update"]);
    expect(calls).toHaveLength(10);
  });
});

function user(email: string, name: string) {
  return create(UserRecordSchema, { id: requestId, email, name, platformRole: "user", status: "active", version: BigInt(1), createdAt: now, updatedAt: now });
}

function organizationRole() {
  return create(RoleRecordSchema, { id: roleId, organizationId, key: "billing_reviewer", name: "Billing reviewer", description: "Reviews billing", status: "active", version: BigInt(1), permissionKeys: ["billing:read"] });
}

function siteRole() {
  return create(SiteRoleRecordSchema, { id: roleId, siteId, key: "content_editor", name: "Content editor", description: "Edits content", status: "active", version: BigInt(1), permissionKeys: ["site:update"] });
}
