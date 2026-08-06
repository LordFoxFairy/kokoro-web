import { afterEach, describe, expect, it, vi } from "vitest";

import { adminDataProvider } from "./admin-data-provider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Refine typed Admin data provider", () => {
  it("maps the operators resource to its exact typed BFF route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      items: [{
        operatorRef: "operator:one",
        operatorGeneration: "1",
        state: "active",
        effectivePermissions: ["operator.read"],
        effectiveSiteScopes: [{ siteId: "site-one" }],
        expiresAt: "2026-08-07T00:00:00.000Z",
      }],
      nextPageToken: null,
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminDataProvider.getList({ resource: "operators", pagination: { mode: "off" } });

    expect(fetchMock).toHaveBeenCalledWith("/api/control/operators", expect.any(Object));
    expect(result).toEqual({
      data: [expect.objectContaining({ operatorRef: "operator:one", state: "active" })],
      total: 1,
    });
  });

  it("rejects unregistered resources before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(adminDataProvider.getList({ resource: "arbitrary-table" })).rejects.toMatchObject({
      statusCode: 404,
      message: "admin_resource_not_registered",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects generic mutations before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(adminDataProvider.create({ resource: "operators", variables: {} })).rejects.toMatchObject({
      statusCode: 405,
      message: "admin_resource_operation_not_supported",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
