import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  activateModelInventory: vi.fn(),
  changeModelSitePolicy: vi.fn(),
  importModelInventory: vi.fn(),
  listModelInventoryBindings: vi.fn(),
  listModelInventoryDefinitions: vi.fn(),
  listModelInventoryProviders: vi.fn(),
  listModelInventoryRevisions: vi.fn(),
  listModelInventoryRoutes: vi.fn(),
  listModelOptions: vi.fn(),
  listModelSitePolicies: vi.fn(),
  listModelSiteReleaseCatalogs: vi.fn(),
  materializeModelOptions: vi.fn(),
  publishModelSiteReleaseCatalog: vi.fn(),
}));

vi.mock("@/lib/control-plane/client", () => ({
  AdminControlPlaneError: class AdminControlPlaneError extends Error {},
  ...calls,
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const call of Object.values(calls)) {
    call.mockResolvedValue({ items: [], nextPageToken: null, asOf: "2026-07-30T00:00:00.000Z" });
  }
});

const inventoryDigest = "a".repeat(64);

function jsonRequest(body: unknown): Request {
  return new Request("https://admin.example/api/control/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("typed Model control route", () => {
  it("queries one immutable inventory through the typed provider reader", async () => {
    const route = await import("../app/api/control/models/route");
    const response = await route.GET(new Request(
      `https://admin.example/api/control/models?view=providers&inventoryDigest=${inventoryDigest}&pageToken=next`,
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(calls.listModelInventoryProviders).toHaveBeenCalledWith(inventoryDigest, "next");
  });

  it.each([
    "https://admin.example/api/control/models?view=providers",
    `https://admin.example/api/control/models?view=providers&inventoryDigest=${inventoryDigest}&unexpected=1`,
    `https://admin.example/api/control/models?view=providers&inventoryDigest=${inventoryDigest}&pageToken=one&pageToken=two`,
    "https://admin.example/api/control/models?view=unknown",
  ])("rejects incomplete or non-canonical read queries: %s", async (url) => {
    const route = await import("../app/api/control/models/route");
    const response = await route.GET(new Request(url));

    expect(response.status).toBe(400);
    expect(calls.listModelInventoryProviders).not.toHaveBeenCalled();
  });

  it("activates a directory version only from a strict typed command", async () => {
    calls.activateModelInventory.mockResolvedValue({
      receipt: { commandId: "command-one", state: "committed" },
    });
    const route = await import("../app/api/control/models/route");
    const response = await route.POST(jsonRequest({
      action: "activate_inventory",
      targetDigest: inventoryDigest,
      expectedPointerRevision: "17",
    }));

    expect(response.status).toBe(201);
    expect(calls.activateModelInventory).toHaveBeenCalledWith(inventoryDigest, "17");

    const rejected = await route.POST(jsonRequest({
      action: "activate_inventory",
      targetDigest: inventoryDigest,
      expectedPointerRevision: "17",
      bypassStepUp: true,
    }));
    expect(rejected.status).toBe(400);
    expect(calls.activateModelInventory).toHaveBeenCalledTimes(1);
  });
});

describe("Model control console boundary", () => {
  const source = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

  it("uses one typed BFF for the entire Model control lifecycle", () => {
    const consoleSource = source("app/models/models-console.tsx");

    expect(consoleSource).toContain("/api/control/models");
    expect(consoleSource).not.toContain("/api/resource");
    for (const action of ["import_inventory", "activate_inventory", "materialize_options",
      "change_site_policy", "publish_site_release_catalog"]) {
      expect(consoleSource).toContain(`action: "${action}"`);
    }
    for (const operation of ["model.inventory.import", "model.inventory.activate", "model.option.materialize",
      "model.site-policy.change", "model.site-release-catalog.publish"]) {
      expect(consoleSource).toContain(`stepUp("${operation}"`);
    }
  });

  it("exposes only provider secret presence and keeps the object-first information architecture", () => {
    const consoleSource = source("app/models/models-console.tsx");

    expect(consoleSource).toContain("secretReferencePresent");
    expect(consoleSource).not.toContain("secretRef:");
    for (const label of ["版本", "提供方", "模型目录", "产品选项", "站点发布"]) {
      expect(consoleSource).toContain(`"${label}"`);
    }
  });
});
