import { afterEach, describe, expect, it, vi } from "vitest";

import { adminDataProvider, adminNextPageParam } from "./admin-data-provider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Refine typed Admin data provider", () => {
  it("exposes and follows the opaque Operator cursor through Refine infinite pagination", async () => {
    const opaqueCursor = `opaque+${"x".repeat(1_017)}`;
    const operator = (operatorRef: string) => ({
      operatorRef,
      operatorGeneration: "1",
      state: "active",
      effectivePermissions: ["operator.read"],
      effectiveSiteScopes: [{ siteId: "site-one", environment: "production", region: "us-east-1",
        scopeEpoch: "2", expiresAt: "2026-08-07T00:00:00.000Z" }],
      operatorSecurityEpoch: "3",
      authorizationEpoch: "4",
      expiresAt: "2026-08-07T00:00:00.000Z",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        items: [operator("operator:one")], nextPageToken: opaqueCursor,
      } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        items: [operator("operator:two")], nextPageToken: null,
      } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const first = await adminDataProvider.getList({
      resource: "operators",
      pagination: { mode: "server", currentPage: 1, pageSize: 100 },
      meta: { signal: controller.signal },
    });

    expect(first).toEqual({
      data: [expect.objectContaining({ id: "operator:one", operatorRef: "operator:one", state: "active" })],
      total: 1,
      cursor: { next: opaqueCursor },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/control/operators",
      expect.objectContaining({ signal: controller.signal }));

    const second = await adminDataProvider.getList({
      resource: "operators",
      pagination: { mode: "server", currentPage: opaqueCursor as unknown as number, pageSize: 100 },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      `/api/control/operators?pageToken=${encodeURIComponent(opaqueCursor)}`,
      expect.any(Object));
    expect(second).toEqual({
      data: [expect.objectContaining({ id: "operator:two", operatorRef: "operator:two", state: "active" })],
      total: 1,
    });
  });

  it.each([
    {
      resource: "sites",
      path: "/api/control/sites",
      item: { siteRef: "site-one", status: "active", securityEpoch: "4" },
      id: "site-one",
    },
    {
      resource: "approvals",
      path: "/api/control/approvals?siteId=site-one",
      filters: [{ field: "siteId", operator: "eq" as const, value: "site-one" }],
      item: { approvalRef: "00000000-0000-4000-8000-000000000001", operation: "site.publish", makerRef: "operator:one",
        targetSiteRef: "site-one", environment: "production", region: "us-east-1",
        operatorReason: "reviewed", admittedAt: "2026-08-06T00:00:00.000Z",
        expiresAt: "2026-08-07T00:00:00.000Z" },
      id: "00000000-0000-4000-8000-000000000001",
    },
    {
      resource: "audit",
      path: "/api/control/audit?siteId=site-one",
      filters: [{ field: "siteId", operator: "eq" as const, value: "site-one" }],
      item: { auditRef: "audit-one", actionCode: "site.publish", occurredAt: "2026-08-06T00:00:00.000Z" },
      id: "audit-one",
    },
  ])("maps $resource to its exact typed BFF route", async ({ resource, path, filters, item, id }) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      items: [item], nextPageToken: null,
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminDataProvider.getList({
      resource,
      pagination: { mode: "server", currentPage: 1, pageSize: 100 },
      filters,
    });

    expect(fetchMock).toHaveBeenCalledWith(path, expect.any(Object));
    expect(result).toEqual({ data: [expect.objectContaining({ id })], total: 1 });
  });

  it("loads Site detail through the registered resource boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      siteRef: "site/one", status: "active", securityEpoch: "4",
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminDataProvider.getOne({ resource: "sites", id: "site/one" });

    expect(fetchMock).toHaveBeenCalledWith("/api/control/sites/site%2Fone", expect.any(Object));
    expect(result.data).toEqual({ id: "site/one", siteRef: "site/one", status: "active", securityEpoch: "4" });
  });

  it("rejects unsupported resource filters before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(adminDataProvider.getList({
      resource: "audit",
      pagination: { mode: "server", currentPage: 1, pageSize: 100 },
      filters: [{ field: "actionCode", operator: "eq", value: "site.publish" }],
    })).rejects.toMatchObject({ statusCode: 400, message: "admin_resource_filter_not_supported" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects offset pages and caller-selected page sizes before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(adminDataProvider.getList({ resource: "operators",
      pagination: { mode: "server", currentPage: 2, pageSize: 100 } }))
      .rejects.toMatchObject({ statusCode: 400, message: "admin_resource_pagination_not_supported" });
    await expect(adminDataProvider.getList({ resource: "operators",
      pagination: { mode: "server", currentPage: 1, pageSize: 10 } }))
      .rejects.toMatchObject({ statusCode: 400, message: "admin_resource_pagination_not_supported" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes typed BFF failures to Refine HttpError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "operator.auth", message: "operator list forbidden" },
    }), { status: 403, headers: { "content-type": "application/json" } })));

    await expect(adminDataProvider.getList({ resource: "operators",
      pagination: { mode: "server", currentPage: 1, pageSize: 100 } }))
      .rejects.toMatchObject({ statusCode: 403, message: "operator list forbidden", code: "operator.auth" });
  });

  it("rejects an Approval response wider than the generated Admin Query contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      items: [{ approvalRef: "00000000-0000-4000-8000-000000000001", operation: "x".repeat(129),
        makerRef: "operator:one", targetSiteRef: null, environment: "production", region: "us-east-1",
        operatorReason: "reviewed", admittedAt: "2026-08-06T00:00:00.000Z",
        expiresAt: "2026-08-07T00:00:00.000Z" }],
      nextPageToken: null,
    } }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(adminDataProvider.getList({ resource: "approvals",
      pagination: { mode: "server", currentPage: 1, pageSize: 100 } }))
      .rejects.toMatchObject({ statusCode: 502, message: "admin_resource_response_invalid" });
  });

  it("normalizes malformed uint64 response fields to a 502 schema failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      items: [{ operatorRef: "operator:one", operatorGeneration: "not-a-number", state: "active",
        effectivePermissions: [], effectiveSiteScopes: [], operatorSecurityEpoch: "1", authorizationEpoch: "1",
        expiresAt: "2026-08-07T00:00:00.000Z" }], nextPageToken: null,
    } }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(adminDataProvider.getList({ resource: "operators",
      pagination: { mode: "server", currentPage: 1, pageSize: 100 } }))
      .rejects.toMatchObject({ statusCode: 502, message: "admin_resource_response_invalid" });
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

  it.each(["constructor", "toString", "__proto__"])(
    "rejects prototype resource key %s before network access",
    async (resource) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(adminDataProvider.getList({ resource,
        pagination: { mode: "server", currentPage: 1, pageSize: 100 } }))
        .rejects.toMatchObject({ statusCode: 404, message: "admin_resource_not_registered" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

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

describe("Refine Admin cursor continuation", () => {
  it("uses only an explicit opaque next cursor", () => {
    expect(adminNextPageParam({ data: [], total: 1, cursor: { next: "opaque-next" } }))
      .toBe("opaque-next");
  });

  it("does not fall back to numeric pagination for a terminal opaque cursor named zero", () => {
    expect(adminNextPageParam({ data: [], total: 100,
      pagination: { mode: "server", currentPage: "0" as unknown as number, pageSize: 100 } }))
      .toBeUndefined();
  });
});
