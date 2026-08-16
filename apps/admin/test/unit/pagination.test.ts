import { describe, expect, it } from "vitest";

import { parseSessionFilters } from "../../modules/iam/sessions/query";
import { sessionListHref } from "../../modules/iam/sessions/url";
import { parseUserFilters } from "../../modules/iam/users/query";
import { userListHref } from "../../modules/iam/users/url";

describe("IAM URL filters and cursor pagination", () => {
  it("WEB-UNIT-PAGE-001 defaults to 25 caps at 100 and round-trips opaque cursors", () => {
    expect(parseUserFilters({})).toEqual({
      query: "",
      status: "all",
      includeDeleted: false,
      cursor: null,
      limit: 25,
    });
    expect(parseUserFilters({
      query: "  admin@example.com ",
      status: "deleted",
      includeDeleted: "true",
      cursor: "opaque+/cursor==",
      limit: "999",
    })).toEqual({
      query: "admin@example.com",
      status: "deleted",
      includeDeleted: true,
      cursor: "opaque+/cursor==",
      limit: 100,
    });
    expect(parseSessionFilters({ userId: firstUserId, cursor: "next/cursor", limit: "50" }))
      .toEqual({ userId: firstUserId, cursor: "next/cursor", limit: 50 });
  });

  it("WEB-UNIT-PAGE-001 clears cursor on a filter change and preserves it on next-page links", () => {
    const filters = parseUserFilters({
      query: "admin",
      status: "suspended",
      includeDeleted: "true",
      cursor: "old-cursor",
    });

    expect(userListHref(filters)).toBe("/users?query=admin&status=suspended&includeDeleted=true&limit=25");
    expect(userListHref(filters, "new/cursor")).toBe(
      "/users?query=admin&status=suspended&includeDeleted=true&limit=25&cursor=new%2Fcursor",
    );
    expect(sessionListHref(parseSessionFilters({ userId: firstUserId }), "session/cursor"))
      .toBe(`/sessions?userId=${firstUserId}&limit=25&cursor=session%2Fcursor`);
  });

  it("WEB-UNIT-PAGE-001 rejects malformed filters instead of forwarding them to IAM", () => {
    expect(() => parseUserFilters({ status: "banned" })).toThrow("invalid user filters");
    expect(() => parseUserFilters({ status: ["active", "deleted"] })).toThrow("invalid user filters");
    expect(() => parseUserFilters({ cursor: "x".repeat(513) })).toThrow("invalid user filters");
    expect(() => parseSessionFilters({ userId: "not-a-uuid" })).toThrow("invalid session filters");
  });
});

const firstUserId = "bce7762a-f7c7-4d22-8031-4336803038eb";
