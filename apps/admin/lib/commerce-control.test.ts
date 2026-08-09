import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  listCreditPrograms: vi.fn(), getCreditProgram: vi.fn(), publishCreditProgram: vi.fn(),
  listEntitlementTemplates: vi.fn(), getEntitlementTemplate: vi.fn(), publishEntitlementTemplate: vi.fn(),
  listOffers: vi.fn(), getOffer: vi.fn(), publishOffer: vi.fn(),
  listRedemptionPrograms: vi.fn(), getRedemptionProgram: vi.fn(), publishRedemptionProgram: vi.fn(),
  listCodeBatches: vi.fn(), getCodeBatch: vi.fn(), issueCodeBatch: vi.fn(), approveCodeBatch: vi.fn(),
  activateCodeBatch: vi.fn(), abandonCodeBatch: vi.fn(), suspendCodeBatch: vi.fn(), revokeCodeBatch: vi.fn(),
}));

const listRoutes = {
  "credit-programs": () => import("../app/api/control/commerce/credit-programs/route"),
  "entitlement-templates": () => import("../app/api/control/commerce/entitlement-templates/route"),
  offers: () => import("../app/api/control/commerce/offers/route"),
  "redemption-programs": () => import("../app/api/control/commerce/redemption-programs/route"),
  "code-batches": () => import("../app/api/control/commerce/code-batches/route"),
} as const;

vi.mock("@/lib/control-plane/commerce-client", () => ({ adminCommerceClient: calls }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ["listCreditPrograms", "listEntitlementTemplates", "listOffers",
    "listRedemptionPrograms", "listCodeBatches"] as const) {
    calls[name].mockResolvedValue({ items: [], nextPageToken: null, observedAt: "2026-08-09T00:00:00.000Z" });
  }
  calls.getCreditProgram.mockResolvedValue({ id: "credit:one:v1", siteId: "site-one" });
  calls.issueCodeBatch.mockResolvedValue({ disposition: "committed", delivery: { kind: "secret_export", rawCodes: ["secret"] } });
  calls.approveCodeBatch.mockResolvedValue({ batchRef: "00000000-0000-4000-8000-000000000001", state: "draft" });
});

describe("exact same-origin AdminCommerce BFF routes", () => {
  it.each([
    ["credit-programs", "listCreditPrograms"],
    ["entitlement-templates", "listEntitlementTemplates"],
    ["offers", "listOffers"],
    ["redemption-programs", "listRedemptionPrograms"],
    ["code-batches", "listCodeBatches"],
  ] as const)("passes the opaque %s cursor token unchanged", async (resource, method) => {
    const route = await listRoutes[resource]();
    const pageToken = `hmac.${"x".repeat(1_990)}`;
    const response = await route.GET(new Request(
      `https://admin.example/api/control/commerce/${resource}?siteId=site-one&pageToken=${pageToken}`,
    ));

    expect(response.status).toBe(200);
    expect(calls[method]).toHaveBeenCalledWith({ siteId: "site-one", pageToken });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects missing Site, duplicate cursor, unknown query and cursor overflow before Connect", async () => {
    const route = await import("../app/api/control/commerce/offers/route");
    for (const url of [
      "https://admin.example/api/control/commerce/offers",
      "https://admin.example/api/control/commerce/offers?siteId=one&siteId=two",
      "https://admin.example/api/control/commerce/offers?siteId=one&unknown=x",
      `https://admin.example/api/control/commerce/offers?siteId=one&pageToken=${"x".repeat(2_049)}`,
    ]) expect((await route.GET(new Request(url))).status).toBe(400);
    expect(calls.listOffers).not.toHaveBeenCalled();
  });

  it("uses an exact resource detail route without a generic view proxy", async () => {
    const route = await import("../app/api/control/commerce/credit-programs/[revisionRef]/route");
    const response = await route.GET(new Request(
      "https://admin.example/api/control/commerce/credit-programs/credit%3Aone%3Av1?siteId=site-one",
    ), { params: Promise.resolve({ revisionRef: "credit:one:v1" }) });

    expect(response.status).toBe(200);
    expect(calls.getCreditProgram).toHaveBeenCalledWith("site-one", "credit:one:v1");
  });

  it("returns Issue raw codes only under no-store and admits only the exact strict body", async () => {
    const route = await import("../app/api/control/commerce/code-batches/route");
    const body = { siteId: "site-one", batchRef: "00000000-0000-4000-8000-000000000001",
      redemptionProgramRevisionRef: "redeem:one:v1", count: 1 };
    const response = await route.POST(jsonRequest(
      "https://admin.example/api/control/commerce/code-batches", body,
    ));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ data: expect.objectContaining({
      delivery: { kind: "secret_export", rawCodes: ["secret"] },
    }) });
    const rejected = await route.POST(jsonRequest(
      "https://admin.example/api/control/commerce/code-batches", { ...body, rawCodes: ["injected"] },
    ));
    expect(rejected.status).toBe(400);
    expect(calls.issueCodeBatch).toHaveBeenCalledTimes(1);
  });

  it("mounts explicit batch action routes and no generic [action] dispatcher", async () => {
    const approve = await import("../app/api/control/commerce/code-batches/[batchRef]/approve/route");
    const response = await approve.POST(jsonRequest(
      "https://admin.example/api/control/commerce/code-batches/00000000-0000-4000-8000-000000000001/approve",
      { siteId: "site-one" },
    ), { params: Promise.resolve({ batchRef: "00000000-0000-4000-8000-000000000001" }) });

    expect(response.status).toBe(200);
    expect(calls.approveCodeBatch).toHaveBeenCalledWith("site-one", "00000000-0000-4000-8000-000000000001");
    expect(existsSync(resolve(import.meta.dirname,
      "../app/api/control/commerce/code-batches/[batchRef]/[action]/route.ts"))).toBe(false);
  });
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body) });
}
