import type { BaseRecord, GetListResponse } from "@refinedev/core";
import { describe, expect, it } from "vitest";

import { adminInfiniteResult, adminNextPageParam } from "./admin-data-provider";

function page(ids: readonly string[], next?: string): GetListResponse<BaseRecord> {
  return {
    data: ids.map((id) => ({ id })),
    total: ids.length,
    ...(next === undefined ? {} : { cursor: { next } }),
  };
}

function ids(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

describe("Admin infinite pagination window", () => {
  it("stops an A-B-A cursor cycle and hides the accumulated records", () => {
    const pages = [page(["one"], "cursor-a"), page(["two"], "cursor-b"), page(["three"], "cursor-a")];
    const pageParams = [1, "cursor-a", "cursor-b"];

    expect(adminNextPageParam(pages[2], pages, pageParams[2], pageParams)).toBeUndefined();
    expect(adminInfiniteResult({ pages, pageParams })).toEqual({
      records: [],
      error: expect.objectContaining({ statusCode: 502, message: "admin_resource_cursor_loop" }),
    });
  });

  it("stops repeated page params even when the terminal page has no next cursor", () => {
    const pages = [page(["one"], "cursor-a"), page(["two"], "cursor-b"), page(["three"])];
    const pageParams = [1, "cursor-a", "cursor-a"];

    expect(adminNextPageParam(pages[2], pages, pageParams[2], pageParams)).toBeUndefined();
    expect(adminInfiniteResult({ pages, pageParams }).error).toMatchObject({
      statusCode: 502,
      message: "admin_resource_cursor_loop",
    });
  });

  it("fails closed when record IDs repeat across pages", () => {
    const pages = [page(["duplicate"], "cursor-a"), page(["duplicate"])];
    const pageParams = [1, "cursor-a"];

    expect(adminNextPageParam(pages[1], pages, pageParams[1], pageParams)).toBeUndefined();
    expect(adminInfiniteResult({ pages, pageParams })).toEqual({
      records: [],
      error: expect.objectContaining({ statusCode: 502, message: "admin_resource_duplicate_item" }),
    });
  });

  it("allows a terminal twentieth page but rejects continuation beyond it", () => {
    const terminalPages = Array.from({ length: 20 }, (_, index) => page([], index === 19 ? undefined : `p-${index + 1}`));
    const pageParams = [1, ...Array.from({ length: 19 }, (_, index) => `p-${index + 1}`)];

    expect(adminInfiniteResult({ pages: terminalPages, pageParams })).toEqual({ records: [], error: null });

    const continuingPages = terminalPages.map((item, index) => index === 19 ? page([], "p-20") : item);
    expect(adminNextPageParam(continuingPages[19], continuingPages, pageParams[19], pageParams)).toBeUndefined();
    expect(adminInfiniteResult({ pages: continuingPages, pageParams }).error).toMatchObject({
      statusCode: 502,
      message: "admin_resource_page_limit",
    });

    expect(adminInfiniteResult({
      pages: [...terminalPages, page([])],
      pageParams: [...pageParams, "p-20"],
    }).error).toMatchObject({ statusCode: 502, message: "admin_resource_page_limit" });
  });

  it("allows 1000 terminal records but rejects continuation or accumulation beyond it", () => {
    const terminalPages = Array.from({ length: 10 }, (_, index) =>
      page(ids(`page-${index}`, 100), index === 9 ? undefined : `p-${index + 1}`));
    const pageParams = [1, ...Array.from({ length: 9 }, (_, index) => `p-${index + 1}`)];

    expect(adminInfiniteResult({ pages: terminalPages, pageParams })).toMatchObject({
      records: { length: 1000 },
      error: null,
    });

    const continuingPages = terminalPages.map((item, index) =>
      index === 9 ? page(ids("page-9", 100), "p-10") : item);
    expect(adminNextPageParam(continuingPages[9], continuingPages, pageParams[9], pageParams)).toBeUndefined();
    expect(adminInfiniteResult({ pages: continuingPages, pageParams }).error).toMatchObject({
      statusCode: 502,
      message: "admin_resource_item_limit",
    });

    const oversizedPages = [...terminalPages, page(["overflow"])];
    expect(adminInfiniteResult({ pages: oversizedPages, pageParams: [...pageParams, "p-10"] }).error).toMatchObject({
      statusCode: 502,
      message: "admin_resource_item_limit",
    });
  });

  it("flattens a valid bounded window in page order", () => {
    expect(adminInfiniteResult({
      pages: [page(["one", "two"], "cursor-a"), page(["three"])],
      pageParams: [1, "cursor-a"],
    })).toEqual({ records: [{ id: "one" }, { id: "two" }, { id: "three" }], error: null });
  });
});
