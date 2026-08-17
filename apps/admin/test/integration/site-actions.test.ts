import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { IamAuthorizationService } from "../../generated/iam/proto/kokoro/iam/v1/authorization_pb";
import { IamSiteService } from "../../generated/iam/proto/kokoro/iam/v1/site_pb";
import {
  SecurityEventRecordSchema,
  SiteMemberRecordSchema,
  SiteRecordSchema,
  UserRecordSchema,
  type CommandContext,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { createSiteActionHandler } from "../../modules/iam/sites/actions";
import { loadSiteDetail, loadSites, parseSiteDetailFilters, parseSiteFilters } from "../../modules/iam/sites/query";
import type { SiteCommandActionInput } from "../../modules/iam/sites/schema";
import { createIamManagementClient } from "../../server/iam/management-client";

const siteId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const memberId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const commandId = "df486566-7614-461f-a72c-1b3d4ea9e985";
const now = new Date("2026-08-17T10:00:00.000Z");

describe("IAM Site server vertical slice", () => {
  it("WEB-INT-SITE-001 rejects unknown, repeated and malformed list filters", () => {
    expect(() => parseSiteFilters({ unknown: "value" })).toThrow("invalid site filters");
    expect(() => parseSiteFilters({ query: ["one", "two"] })).toThrow("invalid site filters");
    expect(() => parseSiteFilters({ includeDeleted: "yes" })).toThrow("invalid site filters");
    expect(() => parseSiteFilters({ status: "inactive" })).toThrow("invalid site filters");
    expect(() => parseSiteDetailFilters({ authorizationUserId: userId })).toThrow("invalid site detail filters");
    expect(() => parseSiteDetailFilters({ resourceRef: "workspace:primary" })).toThrow("invalid site detail filters");
  });

  it("WEB-INT-SITE-001 composes list/detail, scoped members, authorization and Site audit", async () => {
    const observed: Array<Record<string, unknown>> = [];
    const transport = createRouterTransport((router) => {
      router.service(IamSiteService, {
        listSites: (request) => {
          observed.push({ method: "listSites", ...request });
          return { sites: [site("deleted")], page: { nextCursor: "next/cursor" } };
        },
        getSite: (request) => {
          observed.push({ method: "getSite", ...request });
          return { site: site("deleted") };
        },
        listSiteMembers: (request) => {
          observed.push({ method: "listSiteMembers", ...request });
          return { members: [member("active", "owner")], page: { nextCursor: "member/cursor" } };
        },
      });
      router.service(IamAdministrationService, {
        listUsers: (request) => {
          observed.push({ method: "listUsers", ...request });
          return { users: [user()], page: {} };
        },
        listSecurityEvents: (request) => {
          observed.push({ method: "listSecurityEvents", ...request });
          return {
            events: [securityEvent(siteId)],
            page: {},
            statistics: { total: BigInt(1), byKind: [{ kind: "site.deleted", count: BigInt(1) }] },
          };
        },
      });
      router.service(IamAuthorizationService, {
        listPermissionCatalog: () => ({ permissions: [] }),
        inspectUserSiteAuthorization: (request) => {
          observed.push({ method: "inspectUserSiteAuthorization", ...request });
          return {
            allowed: true,
            reasonCode: "allowed",
            userId,
            siteId,
            roleKeys: ["owner"],
            authorizationVersion: BigInt(11),
            evaluatedAt: timestampFromDate(now),
          };
        },
      });
    });
    const client = createIamManagementClient(transport);

    const list = await loadSites(client, {
      query: " kokoro ", status: "deleted", includeDeleted: "true", cursor: "opaque/cursor", limit: "999",
    });
    const detail = await loadSiteDetail(client, siteId, {
      memberQuery: " owner@example.com ", includeDeletedMembers: "true",
      permissionKey: "site:delete", authorizationUserId: userId, resourceRef: "workspace:primary",
    });

    expect(list).toMatchObject({
      items: [{ id: siteId, status: "deleted" }],
      nextCursor: "next/cursor",
      filters: { query: "kokoro", status: "deleted", includeDeleted: true, cursor: "opaque/cursor", limit: 100 },
    });
    expect(detail).toMatchObject({
      site: { id: siteId, code: "kokoro-main", status: "deleted" },
      members: {
        items: [{ id: memberId, siteId, userLabel: "owner@example.com", roleKey: "owner" }],
        nextCursor: "member/cursor",
        roleOptions: [{ key: "owner" }, { key: "admin" }, { key: "member" }],
      },
      authorization: { allowed: true, userId, siteId, authorizationVersion: "11" },
      audit: { items: [{ siteId, kind: "site.deleted" }], statistics: { total: "1" } },
    });
    expect(observed).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "listSites", query: "kokoro", status: "deleted", includeDeleted: true }),
      expect.objectContaining({ method: "getSite", siteId, includeDeleted: true }),
      expect.objectContaining({ method: "listSiteMembers", siteId, includeDeleted: true }),
      expect.objectContaining({ method: "listUsers", query: "owner@example.com", status: "active" }),
      expect.objectContaining({ method: "listSecurityEvents", siteId }),
      expect.objectContaining({
        method: "inspectUserSiteAuthorization", siteId, userId, permissionKey: "site:delete",
        resourceRef: "workspace:primary",
      }),
    ]));
  });

  it("WEB-INT-SITE-001 executes every Site and Site-member command with command identity and version", async () => {
    const calls: Array<Readonly<{
      operation: string;
      siteId: string;
      memberId?: string;
      expectedVersion?: bigint;
      requestId: string;
      commandId: string;
      reason: string;
    }>> = [];
    const transport = createRouterTransport((router) => {
      router.service(IamSiteService, {
        createSite: (request) => ({ site: mutateSite("create", request.command, "active"), owner: member("active", "owner"), replayed: false }),
        updateSite: (request) => ({ site: mutateSite("update", request.command, "active"), replayed: false }),
        suspendSite: (request) => ({ site: mutateSite("suspend", request.command, "suspended"), replayed: false }),
        reactivateSite: (request) => ({ site: mutateSite("reactivate", request.command, "active"), replayed: false }),
        deleteSite: (request) => ({ site: mutateSite("delete", request.command, "deleted"), replayed: false }),
        restoreSite: (request) => ({ site: mutateSite("restore", request.command, "active"), replayed: false }),
        addSiteMember: (request) => ({ member: mutateMember("add-member", request.command, request.siteId, undefined, "active", request.roleKey), replayed: false }),
        changeSiteMemberRole: (request) => ({ member: mutateMember("change-role", request.command, request.siteId, request.memberId, "active", request.roleKey), replayed: false }),
        suspendSiteMember: (request) => ({ member: mutateMember("suspend-member", request.command, request.siteId, request.memberId, "suspended", "admin"), replayed: false }),
        reactivateSiteMember: (request) => ({ member: mutateMember("reactivate-member", request.command, request.siteId, request.memberId, "active", "admin"), replayed: false }),
        removeSiteMember: (request) => ({ member: mutateMember("remove-member", request.command, request.siteId, request.memberId, "deleted", "admin"), replayed: false }),
        restoreSiteMember: (request) => ({ member: mutateMember("restore-member", request.command, request.siteId, request.memberId, "active", "admin"), replayed: false }),
        selectSite: (request) => ({ site: mutateSite("select", request.command, "active") }),
      });
    });
    const revalidated: string[] = [];
    const handle = createSiteActionHandler({
      loadClient: async () => createIamManagementClient(transport),
      revalidatePath: (path) => revalidated.push(path),
    });
    const common = { requestId, reason: "Site governance review" };
    const commands: SiteCommandActionInput[] = [
      { ...common, commandId, operation: "create", code: "kokoro-main", name: "Kokoro Main" },
      ...(["update", "suspend", "reactivate", "delete", "restore"] as const).map((operation, index) => operation === "update"
        ? { ...common, commandId: command(index), operation, siteId, name: "Kokoro Primary", expectedVersion: String(index + 2) }
        : { ...common, commandId: command(index), operation, siteId, expectedVersion: String(index + 2) }),
      { ...common, commandId: command(6), operation: "add-member", siteId, userId, roleKey: "admin" },
      { ...common, commandId: command(7), operation: "change-member-role", siteId, memberId, roleKey: "admin", expectedVersion: "8" },
      ...(["suspend-member", "reactivate-member", "remove-member", "restore-member"] as const).map((operation, index) => ({
        ...common, commandId: command(index + 8), operation, siteId, memberId, expectedVersion: String(index + 9),
      })),
      { ...common, commandId: command(12), operation: "select", siteId, expectedVersion: "13" },
    ];

    for (const input of commands) {
      const result = await handle(input);
      expect(result, input.operation).toMatchObject({ status: "success" });
    }

    expect(calls.map((call) => call.operation)).toEqual([
      "create", "update", "suspend", "reactivate", "delete", "restore", "add-member", "change-role",
      "suspend-member", "reactivate-member", "remove-member", "restore-member", "select",
    ]);
    expect(calls.every((call) => call.requestId === requestId && call.reason === "Site governance review")).toBe(true);
    expect(calls.filter((call) => !["create", "add-member"].includes(call.operation)).every((call) => call.expectedVersion !== undefined)).toBe(true);
    expect(revalidated).toEqual(expect.arrayContaining(["/sites", `/sites/${siteId}`, "/sessions", "/audit"]));

    function capture(operation: string, value: CommandContext | undefined, targetSiteId = siteId, targetMemberId?: string) {
      const context = value ?? missingCommand();
      calls.push({
        operation, siteId: targetSiteId, ...(targetMemberId === undefined ? {} : { memberId: targetMemberId }),
        expectedVersion: context.expectedVersion, requestId: context.requestId, commandId: context.commandId,
        reason: context.reason,
      });
    }
    function mutateSite(operation: string, value: CommandContext | undefined, status: "active" | "suspended" | "deleted") {
      capture(operation, value);
      return site(status);
    }
    function mutateMember(operation: string, value: CommandContext | undefined, targetSiteId: string, targetMemberId: string | undefined, status: "active" | "suspended" | "deleted", roleKey: string) {
      capture(operation, value, targetSiteId, targetMemberId);
      return member(status, roleKey);
    }
  });

  it("WEB-INT-SITE-001 rejects invalid command input before loading the client", async () => {
    let loaded = false;
    const handle = createSiteActionHandler({
      loadClient: async () => { loaded = true; throw new Error("must not load"); },
      revalidatePath: () => undefined,
    });
    expect(await handle({
      operation: "update", siteId, name: " ", expectedVersion: "01", requestId, commandId, reason: " ",
    })).toEqual({ status: "error", commandId, kind: "invalid", requestId });
    expect(loaded).toBe(false);
  });
});

function command(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function missingCommand(): never { throw new Error("command required"); }

function site(status: "active" | "suspended" | "deleted") {
  return create(SiteRecordSchema, {
    id: siteId, code: "kokoro-main", name: "Kokoro Main", status, version: BigInt(7),
    ...(status === "deleted" ? { deletedAt: timestampFromDate(now) } : {}),
    createdAt: timestampFromDate(now), updatedAt: timestampFromDate(now),
  });
}

function member(status: "active" | "suspended" | "deleted", roleKey: string) {
  return create(SiteMemberRecordSchema, {
    id: memberId, siteId, userId, roleId: "4f7556a0-64ea-4da0-8996-d1f744035b75", roleKey,
    status, version: BigInt(3), ...(status === "deleted" ? { deletedAt: timestampFromDate(now) } : {}),
    createdAt: timestampFromDate(now), updatedAt: timestampFromDate(now),
  });
}

function user() {
  return create(UserRecordSchema, {
    id: userId, email: "owner@example.com", name: "Site Owner", platformRole: "user", status: "active",
    version: BigInt(1), createdAt: timestampFromDate(now), updatedAt: timestampFromDate(now),
  });
}

function securityEvent(eventSiteId: string) {
  return create(SecurityEventRecordSchema, {
    id: "3598c32a-c62b-4803-92c2-b5baaf507d9f", kind: "site.deleted", siteId: eventSiteId,
    requestId, commandId, metadataJson: "{}", createdAt: timestampFromDate(now),
  });
}
