import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { IamAuthorizationService } from "../../generated/iam/proto/kokoro/iam/v1/authorization_pb";
import { IamSiteService } from "../../generated/iam/proto/kokoro/iam/v1/site_pb";
import { SiteMemberRecordSchema, SiteRecordSchema } from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { createIamManagementClient } from "../../server/iam/management-client";

const siteId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const memberId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const commandId = "df486566-7614-461f-a72c-1b3d4ea9e985";
const now = new Date("2026-08-17T10:00:00.000Z");

describe("IAM Site generated client", () => {
  it("WEB-INT-SITE-001 preserves Site filters, command scope, membership scope and authorization", async () => {
    const observed: Record<string, unknown>[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamSiteService, {
        listSites: (request) => {
          observed.push({ method: "listSites", ...request });
          return { sites: [site()], page: { nextCursor: "site/cursor" } };
        },
        createSite: (request) => {
          observed.push({ method: "createSite", ...request });
          return { site: site(), owner: member(), replayed: false };
        },
        changeSiteMemberRole: (request) => {
          observed.push({ method: "changeSiteMemberRole", ...request });
          return { member: member(), replayed: false };
        },
        selectSite: (request) => {
          observed.push({ method: "selectSite", ...request });
          return { site: site() };
        },
      });
      router.service(IamAuthorizationService, {
        inspectUserSiteAuthorization: (request) => {
          observed.push({ method: "inspectUserSiteAuthorization", ...request });
          return {
            allowed: true,
            reasonCode: "allowed",
            userId,
            siteId,
            roleKeys: ["owner"],
            authorizationVersion: BigInt(4),
            evaluatedAt: timestampFromDate(now),
          };
        },
      });
    });
    const client = createIamManagementClient(transport);
    const command = { requestId, commandId, reason: "Site management", expectedVersion: BigInt(7) };

    expect(await client.listSites({
      requestId,
      query: "kokoro",
      status: "active",
      includeDeleted: true,
      cursor: "opaque/cursor",
      limit: 25,
    })).toMatchObject({ items: [{ id: siteId }], nextCursor: "site/cursor" });
    expect(await client.createSite(command, "kokoro-main", "Kokoro Main")).toMatchObject({
      value: { id: siteId }, owner: { siteId, userId }, replayed: false,
    });
    expect(await client.changeSiteMemberRole(command, siteId, memberId, "owner")).toMatchObject({
      value: { id: memberId, siteId }, replayed: false,
    });
    expect(await client.selectSite(command, siteId)).toMatchObject({ id: siteId });
    expect(await client.inspectUserSiteAuthorization({
      requestId, siteId, userId, permissionKey: "site:read",
    })).toMatchObject({ allowed: true, siteId, userId });

    expect(observed).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "listSites", query: "kokoro", status: "active", includeDeleted: true }),
      expect.objectContaining({ method: "createSite", code: "kokoro-main", name: "Kokoro Main" }),
      expect.objectContaining({ method: "changeSiteMemberRole", siteId, memberId, roleKey: "owner" }),
      expect.objectContaining({ method: "selectSite", siteId }),
      expect.objectContaining({ method: "inspectUserSiteAuthorization", siteId, userId, permissionKey: "site:read" }),
    ]));
  });
});

function site() {
  return create(SiteRecordSchema, {
    id: siteId,
    code: "kokoro-main",
    name: "Kokoro Main",
    status: "active",
    version: BigInt(7),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}

function member() {
  return create(SiteMemberRecordSchema, {
    id: memberId,
    siteId,
    userId,
    roleId: "4f7556a0-64ea-4da0-8996-d1f744035b75",
    roleKey: "owner",
    status: "active",
    version: BigInt(3),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}
