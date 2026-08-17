import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { IamAuthorizationService } from "../../generated/iam/proto/kokoro/iam/v1/authorization_pb";
import { IamSiteService } from "../../generated/iam/proto/kokoro/iam/v1/site_pb";
import {
  SecurityEventRecordSchema, SiteMemberRecordSchema, SiteRecordSchema,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { createSiteActionHandler } from "../../modules/iam/sites/actions";
import { loadSiteDetail } from "../../modules/iam/sites/query";
import { createIamManagementClient } from "../../server/iam/management-client";

const siteId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const foreignSiteId = "21ec9d0b-429e-473b-b41b-8b52a91ca5d3";
const memberId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const commandId = "df486566-7614-461f-a72c-1b3d4ea9e985";
const now = new Date("2026-08-17T10:00:00.000Z");

describe("IAM Site isolation", () => {
  it("WEB-SEC-SITE-001 rejects a command response scoped to another Site without revalidation", async () => {
    const revalidated: string[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamSiteService, {
        changeSiteMemberRole: () => ({ member: member(foreignSiteId), replayed: false }),
      });
    });
    const handle = createSiteActionHandler({
      loadClient: async () => createIamManagementClient(transport),
      revalidatePath: (path) => revalidated.push(path),
    });

    expect(await handle({
      operation: "change-member-role", siteId, memberId, roleKey: "admin",
      expectedVersion: "1", requestId, commandId, reason: "Access review",
    })).toEqual({ status: "error", commandId, kind: "internal", requestId: "" });
    expect(revalidated).toEqual([]);
  });

  it("WEB-SEC-SITE-001 rejects a created Site whose initial Owner belongs to another Site", async () => {
    const revalidated: string[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamSiteService, {
        createSite: () => ({ site: site(siteId), owner: member(foreignSiteId), replayed: false }),
      });
    });
    const handle = createSiteActionHandler({
      loadClient: async () => createIamManagementClient(transport),
      revalidatePath: (path) => revalidated.push(path),
    });

    expect(await handle({
      operation: "create", code: "local", name: "Local Site", requestId, commandId, reason: "Create Site",
    })).toEqual({ status: "error", commandId, kind: "internal", requestId: "" });
    expect(revalidated).toEqual([]);
  });

  it("WEB-SEC-SITE-001 rejects foreign Site, member, audit and authorization records", async () => {
    let scope: "site" | "member" | "event" | "authorization" = "site";
    const transport = createRouterTransport((router) => {
      router.service(IamSiteService, {
        getSite: () => ({ site: site(scope === "site" ? foreignSiteId : siteId) }),
        listSiteMembers: () => ({ members: scope === "member" ? [member(foreignSiteId)] : [], page: {} }),
        listSiteRoles: () => ({ roles: [] }),
      });
      router.service(IamAdministrationService, {
        listUsers: () => ({ users: [], page: {} }),
        listSecurityEvents: () => ({
          events: scope === "event" ? [event(foreignSiteId)] : [], page: {},
          statistics: { total: BigInt(scope === "event" ? 1 : 0), byKind: [] },
        }),
      });
      router.service(IamAuthorizationService, {
        listPermissionCatalog: () => ({ permissions: [] }),
        inspectUserSiteAuthorization: () => ({
          allowed: false, reasonCode: "permission_denied", userId,
          siteId: scope === "authorization" ? foreignSiteId : siteId,
          roleKeys: ["member"], authorizationVersion: BigInt(2), evaluatedAt: timestampFromDate(now),
        }),
      });
    });
    const client = createIamManagementClient(transport);

    await expect(loadSiteDetail(client, siteId)).rejects.toThrow("invalid site scope");
    scope = "member";
    await expect(loadSiteDetail(client, siteId)).rejects.toThrow("invalid site member scope");
    scope = "event";
    await expect(loadSiteDetail(client, siteId)).rejects.toThrow("invalid site event scope");
    scope = "authorization";
    await expect(loadSiteDetail(client, siteId, {
      permissionKey: "site:read", authorizationUserId: userId,
    })).rejects.toThrow("invalid site authorization scope");
  });
});

function site(id: string) {
  return create(SiteRecordSchema, {
    id, code: id === siteId ? "local" : "foreign", name: "Site", status: "active", version: BigInt(1),
    createdAt: timestampFromDate(now), updatedAt: timestampFromDate(now),
  });
}

function member(targetSiteId: string) {
  return create(SiteMemberRecordSchema, {
    id: memberId, siteId: targetSiteId, userId, roleId: "4f7556a0-64ea-4da0-8996-d1f744035b75",
    roleKey: "admin", status: "active", version: BigInt(1),
    createdAt: timestampFromDate(now), updatedAt: timestampFromDate(now),
  });
}

function event(targetSiteId: string) {
  return create(SecurityEventRecordSchema, {
    id: "3598c32a-c62b-4803-92c2-b5baaf507d9f", kind: "site.updated", siteId: targetSiteId,
    requestId, commandId, createdAt: timestampFromDate(now),
  });
}
