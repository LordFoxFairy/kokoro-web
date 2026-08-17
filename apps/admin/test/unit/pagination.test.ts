import { describe, expect, it } from "vitest";

import { parseAccessFilters } from "../../modules/iam/access/query";
import { accessHref } from "../../modules/iam/access/url";
import { parseSessionFilters } from "../../modules/iam/sessions/query";
import { sessionListHref } from "../../modules/iam/sessions/url";
import { parseUserFilters } from "../../modules/iam/users/query";
import { userListHref } from "../../modules/iam/users/url";

describe("IAM URL filters and cursor pagination", () => {
  it("WEB-UNIT-PAGE-001 defaults to 25 caps at 100 and round-trips opaque cursors", () => {
    expect(parseUserFilters({})).toEqual({
      query: "",
      status: "all",
      platformRole: "all",
      includeDeleted: false,
      cursor: null,
      limit: 25,
    });
    expect(parseUserFilters({
      query: "  admin@example.com ",
      status: "deleted",
      platformRole: "user",
      includeDeleted: "true",
      cursor: "opaque+/cursor==",
      limit: "999",
    })).toEqual({
      query: "admin@example.com",
      status: "deleted",
      platformRole: "user",
      includeDeleted: true,
      cursor: "opaque+/cursor==",
      limit: 100,
    });
    expect(parseSessionFilters({ userId: firstUserId, cursor: "next/cursor", limit: "50" }))
      .toEqual({ userId: firstUserId, cursor: "next/cursor", limit: 50 });
    expect(parseAccessFilters({
      organizationId: firstOrganizationId,
      organizationQuery: "  kokoro  ",
      organizationCursor: "organization/cursor",
      organizationLimit: "999",
      userId: firstUserId,
      userQuery: "  member@example.com  ",
      permissionKey: "organization:delete",
    })).toEqual({
      organizationId: firstOrganizationId,
      organizationQuery: "kokoro",
      organizationCursor: "organization/cursor",
      organizationLimit: 100,
      userId: firstUserId,
      userQuery: "member@example.com",
      permissionKey: "organization:delete",
      resourceRef: null,
    });
  });

  it("WEB-UNIT-PAGE-001 clears cursor on a filter change and preserves it on next-page links", () => {
    const filters = parseUserFilters({
      query: "admin",
      status: "suspended",
      platformRole: "admin",
      includeDeleted: "true",
      cursor: "old-cursor",
    });

    expect(userListHref(filters)).toBe("/users?query=admin&status=suspended&platformRole=admin&includeDeleted=true&limit=25");
    expect(userListHref(filters, "new/cursor")).toBe(
      "/users?query=admin&status=suspended&platformRole=admin&includeDeleted=true&limit=25&cursor=new%2Fcursor",
    );
    expect(sessionListHref(parseSessionFilters({ userId: firstUserId }), "session/cursor"))
      .toBe(`/sessions?userId=${firstUserId}&limit=25&cursor=session%2Fcursor`);
    expect(accessHref(parseAccessFilters({
      organizationId: firstOrganizationId,
      organizationQuery: "kokoro",
      userId: firstUserId,
      userQuery: "member",
      permissionKey: "organization:delete",
    }), "organization/cursor")).toBe(
      `/access?organizationId=${firstOrganizationId}&organizationQuery=kokoro&organizationLimit=25&userId=${firstUserId}&userQuery=member&permissionKey=organization%3Adelete&organizationCursor=organization%2Fcursor`,
    );
  });

  it("WEB-UNIT-PAGE-001 rejects malformed filters instead of forwarding them to IAM", () => {
    expect(() => parseUserFilters({ status: "banned" })).toThrow("invalid user filters");
    expect(() => parseUserFilters({ platformRole: "owner" })).toThrow("invalid user filters");
    expect(() => parseUserFilters({ status: ["active", "deleted"] })).toThrow("invalid user filters");
    expect(() => parseUserFilters({ cursor: "x".repeat(513) })).toThrow("invalid user filters");
    expect(() => parseSessionFilters({ userId: "not-a-uuid" })).toThrow("invalid session filters");
    expect(() => parseAccessFilters({ organizationCursor: "x".repeat(513) })).toThrow("invalid access filters");
  });
});

const firstUserId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const firstOrganizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";
