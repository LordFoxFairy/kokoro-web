import { afterEach, describe, expect, it, vi } from "vitest";

import { adminDataProvider, adminInfiniteResult, adminNextPageParam } from "./admin-data-provider";

afterEach(() => { vi.unstubAllGlobals(); });

const instant = "2026-08-09T00:00:00.000Z";
const digest = "a".repeat(64);

describe("five closed Refine AdminCommerce resources", () => {
  it.each([
    ["credit-programs", "/api/control/commerce/credit-programs", {
      id: "credit:one:v1", siteId: "site-one", creditProgramRevisionRef: "credit:one:v1",
      programRef: "credit:one", revision: "1", bucketClass: "permanent", unit: "credit", amount: "100",
      burnPriority: 1, scopePolicy: { policyVersion: 1, surfaceRefs: ["chat"],
        capabilityKeys: ["model.chat"], agentRefs: [], allowUnattributedAgent: true },
      liabilityMerchantAccountRef: "merchant:one", windowKind: "none", rolloverPolicy: "none",
      calendarZone: null, windowAnchor: null, expiresAfterSeconds: null, revisionDigest: digest,
      publishedAt: instant,
    }],
    ["entitlement-templates", "/api/control/commerce/entitlement-templates", {
      id: "entitlement:one:v1", siteId: "site-one", entitlementTemplateRevisionRef: "entitlement:one:v1",
      templateRef: "entitlement:one", revision: "1", capabilityKey: "chat.premium", safeLabel: "Premium chat",
      expiresAfterSeconds: null, revisionDigest: digest, publishedAt: instant,
    }],
    ["offers", "/api/control/commerce/offers", {
      id: "offer:one:v1", siteId: "site-one", productRef: "offer:one", productKind: "credit_pack",
      productVersionRef: "offer:one:v1", revision: "1", safeLabel: "100 credits", planVersion: null,
      fulfillmentProgramRevisionRef: "fulfillment:one:v1", outputs: [{ outputLineId: "line:one", ordinal: 1,
        cardinality: 1, outputKind: "credit_grant", targetRevisionRef: "credit:one:v1" }],
      legalTermRefs: [], publishedAt: instant,
    }],
    ["redemption-programs", "/api/control/commerce/redemption-programs", {
      id: "redemption:one:v1", siteId: "site-one", redemptionProgramRevisionRef: "redemption:one:v1",
      programRef: "redemption:one", revision: "1", productVersionRef: "offer:one:v1",
      fulfillmentProgramRevisionRef: "fulfillment:one:v1", maxRedemptionsPerAccount: 1,
      availabilityState: "active", publishedAt: instant,
    }],
    ["code-batches", "/api/control/commerce/code-batches", {
      id: "00000000-0000-4000-8000-000000000001", siteId: "site-one",
      batchRef: "00000000-0000-4000-8000-000000000001",
      redemptionProgramRevisionRef: "redemption:one:v1", state: "draft", approvalState: "pending",
      inventoryCount: 1, createdByOperatorRef: "operator:maker", startsAt: null, endsAt: null,
      createdAt: instant, activatedAt: null, exportReceipt: {
        batchRef: "00000000-0000-4000-8000-000000000001",
        exportCommandId: "00000000-0000-4000-8000-000000000002",
        exportedToOperatorRef: "operator:maker", codeCount: 1, exportedAt: instant,
      },
    }],
  ] as const)("maps %s only to its exact same-origin BFF", async (resource, path, item) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      items: [item], nextPageToken: null, observedAt: instant,
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminDataProvider.getList({
      resource,
      pagination: { mode: "server", currentPage: 1, pageSize: 100 },
      filters: [{ field: "siteId", operator: "eq", value: "site-one" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(`${path}?siteId=site-one`, expect.any(Object));
    expect(result.data).toEqual([item]);
  });

  it("passes a 2048-character Commerce HMAC cursor unchanged and keeps it opaque", async () => {
    const token = `h.${"x".repeat(2_046)}`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      items: [], nextPageToken: null, observedAt: instant,
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await adminDataProvider.getList({
      resource: "offers",
      pagination: { mode: "server", currentPage: token as unknown as number, pageSize: 100 },
      filters: [{ field: "siteId", operator: "eq", value: "site-one" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/control/commerce/offers?siteId=site-one&pageToken=${encodeURIComponent(token)}`,
      expect.any(Object),
    );
  });

  it("loads exact Commerce detail with Site supplied only as provider meta", async () => {
    const item = { id: "entitlement:one:v1", siteId: "site-one",
      entitlementTemplateRevisionRef: "entitlement:one:v1", templateRef: "entitlement:one", revision: "1",
      capabilityKey: "chat.premium", safeLabel: "Premium chat", expiresAfterSeconds: null,
      revisionDigest: digest, publishedAt: instant };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: item }),
      { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(adminDataProvider.getOne({ resource: "entitlement-templates", id: item.id,
      meta: { siteId: "site-one" } })).resolves.toEqual({ data: item });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/commerce/entitlement-templates/entitlement%3Aone%3Av1?siteId=site-one",
      expect.any(Object),
    );
  });

  it("rejects missing Site selection and all generic mutations before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(adminDataProvider.getList({ resource: "offers",
      pagination: { mode: "server", currentPage: 1, pageSize: 100 } }))
      .rejects.toMatchObject({ statusCode: 400, message: "admin_resource_site_filter_required" });
    await expect(adminDataProvider.getOne({ resource: "offers", id: "offer:one:v1" }))
      .rejects.toMatchObject({ statusCode: 400, message: "admin_resource_site_meta_required" });
    await expect(adminDataProvider.create({ resource: "code-batches", variables: { rawCodes: ["secret"] } }))
      .rejects.toMatchObject({ statusCode: 405, message: "admin_resource_operation_not_supported" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accumulates Commerce pages without putting mutation data into Refine cache", () => {
    const first = { data: [{ id: "offer:one:v1" }], total: 1, cursor: { next: "opaque" } };
    const second = { data: [{ id: "offer:two:v1" }], total: 1 };
    expect(adminNextPageParam(first)).toBe("opaque");
    expect(adminInfiniteResult({ pages: [first, second], pageParams: [1, "opaque"] })).toEqual({
      records: [{ id: "offer:one:v1" }, { id: "offer:two:v1" }], error: null,
    });
  });
});
