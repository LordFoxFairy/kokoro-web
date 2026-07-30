import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Code } from "@connectrpc/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  activateModelInventory: vi.fn(),
  changeModelSitePolicy: vi.fn(),
  getModelInventoryRevision: vi.fn(),
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
  getModelCommandReceipt: vi.fn(),
}));

vi.mock("@/lib/control-plane/client", () => ({
  AdminControlPlaneError: class AdminControlPlaneError extends Error {
    constructor(readonly connectCode: Code, readonly domainCode: string,
      readonly receiptRef: string | null = null) { super("admin_control_plane_request_failed"); }
  },
  ...calls,
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const call of Object.values(calls)) {
    call.mockResolvedValue({ items: [], nextPageToken: null, asOf: "2026-07-30T00:00:00.000Z" });
  }
  calls.getModelInventoryRevision.mockResolvedValue({ inventoryDigest: "a".repeat(64),
    sourceReference: "catalog:one", counts: { providers: 1, models: 2, bindings: 3, productRoutes: 0 },
    importedAt: "2026-07-30T00:00:00.000Z", active: true, activePointerRevision: "7",
    asOf: "2026-07-30T00:01:00.000Z" });
});

const inventoryDigest = "a".repeat(64);
const providerDraft = { key: "provider-one", provider: "openai", accountKey: "primary",
  secretRef: "secret:model/openai", adapterKind: "litellm", priority: 0 } as const;
const modelDraft = { key: "model-one", displayName: "Model One", inputModalities: ["text"],
  outputModalities: ["text"], capabilities: ["chat"], contextWindow: 128_000, enabled: true } as const;
const bindingDraft = { key: "binding-one", modelKey: "model-one", providerKey: "provider-one",
  upstreamModel: "upstream-one", gatewayModelName: "gateway-one", priority: 0, enabled: true } as const;

function jsonRequest(body: unknown): Request {
  return new Request("https://admin.example/api/control/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function chunkStream(chunkCount: number, chunkBytes: number, cancel: () => void): ReadableStream<Uint8Array> {
  let emitted = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= chunkCount) { controller.close(); return; }
      emitted += 1; controller.enqueue(new Uint8Array(chunkBytes));
    },
    cancel,
  });
}

describe("typed Model control route", () => {
  it("gets and positively projects one exact inventory revision", async () => {
    const route = await import("../app/api/control/models/route");
    const response = await route.GET(new Request(
      `https://admin.example/api/control/models?view=inventory&inventoryDigest=${inventoryDigest}`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: expect.objectContaining({
      inventoryDigest,
      sourceReference: "catalog:one",
      asOf: "2026-07-30T00:01:00.000Z",
    }) });
    expect(calls.getModelInventoryRevision).toHaveBeenCalledWith(inventoryDigest);
  });

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

  it("admits the authoritative inventory collection upper bounds and empty product routes", async () => {
    calls.importModelInventory.mockResolvedValue({ receipt: { commandId: "command-one", state: "committed" } });
    const route = await import("../app/api/control/models/route");
    const input = {
      action: "import_inventory",
      sourceReference: "catalog:maximum",
      providers: Array.from({ length: 256 }, () => providerDraft),
      models: Array.from({ length: 2_048 }, () => ({ ...modelDraft,
        inputModalities: Array.from({ length: 32 }, (_, index) => `input-${index}`),
        outputModalities: Array.from({ length: 32 }, (_, index) => `output-${index}`) })),
      bindings: Array.from({ length: 4_096 }, () => bindingDraft),
      productRoutes: [],
      providerAvailability: Array.from({ length: 256 }, () => ({ providerKey: "provider-one",
        status: "active", health: "healthy", epoch: "9223372036854775807" })),
    };
    const response = await route.POST(jsonRequest(input));

    expect(response.status).toBe(201);
    expect(calls.importModelInventory).toHaveBeenCalledWith(input);
  });

  it("rejects PostgreSQL-unsigned numeric values at the browser boundary", async () => {
    const route = await import("../app/api/control/models/route");
    for (const input of [
      { action: "activate_inventory", targetDigest: inventoryDigest,
        expectedPointerRevision: "9223372036854775808" },
      { action: "import_inventory", sourceReference: "catalog:one", providers: [providerDraft],
        models: [{ ...modelDraft, contextWindow: 2_147_483_648 }], bindings: [bindingDraft],
        productRoutes: [], providerAvailability: [{ providerKey: "provider-one", status: "active",
          health: "healthy", epoch: "9223372036854775808" }] },
    ]) {
      expect((await route.POST(jsonRequest(input))).status).toBe(400);
    }
    expect(calls.activateModelInventory).not.toHaveBeenCalled();
    expect(calls.importModelInventory).not.toHaveBeenCalled();
  });

  it.each([
    { action: "import_inventory", sourceReference: "catalog:one", providers: [providerDraft],
      models: [{ ...modelDraft, capabilities: ["chat", "chat"] }], bindings: [bindingDraft], productRoutes: [] },
    { action: "materialize_options", inventoryDigest, options: [{ optionKey: "chat-default", surface: "chat",
      label: "Chat", lifecycle: "active", orchestration: { primaryModelKey: "model-one",
        fallbackModelKeys: ["model-two", "model-two"] }, generation: { primaryModelKey: "model-one",
        fallbackModelKeys: [] } }] },
    { action: "publish_site_release_catalog", siteId: "site-one", siteReleaseRef: "release:one", inventoryDigest,
      surfaces: [{ surface: "chat", allowedOptionRevisionRefs: ["option:one", "option:one"],
        defaultModelOptionRevisionRef: "option:one" }] },
  ])("rejects repeated scalar values forbidden by Buf Validate", async (input) => {
    const route = await import("../app/api/control/models/route");
    const response = await route.POST(jsonRequest(input));

    expect(response.status).toBe(400);
  });

  it.each([
    { action: "import_inventory", sourceReference: "catalog:one", providers: [providerDraft],
      models: [{ ...modelDraft, capabilities: [""] }], bindings: [bindingDraft], productRoutes: [] },
    { action: "import_inventory", sourceReference: "catalog:one", providers: [providerDraft],
      models: [{ ...modelDraft, inputModalities: ["x".repeat(129)] }], bindings: [bindingDraft], productRoutes: [] },
    { action: "publish_site_release_catalog", siteId: "site-one", siteReleaseRef: "release:one", inventoryDigest,
      surfaces: [{ surface: "chat", allowedOptionRevisionRefs: ["x".repeat(257)],
        defaultModelOptionRevisionRef: "option:one" }] },
  ])("rejects repeated scalar items outside the Buf item bounds", async (input) => {
    const route = await import("../app/api/control/models/route");
    const response = await route.POST(jsonRequest(input));

    expect(response.status).toBe(400);
  });

  it("rejects a command over the 16 MiB transport budget as payload-too-large", async () => {
    const route = await import("../app/api/control/models/route");
    const response = await route.POST(new Request("https://admin.example/api/control/models", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(16 * 1024 * 1024 + 1) },
      body: "{}",
    }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: "request.payload_too_large" } });
  });

  it.each([undefined, "1"])("stops an oversized streamed command with Content-Length %s", async (length) => {
    const route = await import("../app/api/control/models/route");
    const cancel = vi.fn();
    const headers = new Headers({ "content-type": "application/json" });
    if (length !== undefined) headers.set("content-length", length);
    const response = await route.POST(new Request("https://admin.example/api/control/models", {
      method: "POST", headers, body: chunkStream(18, 1024 * 1024, cancel), duplex: "half",
    } as RequestInit & { duplex: "half" }));

    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("routes receipt reconciliation through the typed Model BFF", async () => {
    calls.getModelCommandReceipt.mockResolvedValue({ receipt: { commandId: "a".repeat(32), state: "committed" } });
    const route = await import("../app/api/control/models/route");
    const response = await route.GET(new Request("https://admin.example/api/control/models?view=receipt"
      + `&receiptRef=${"a".repeat(32)}&requestDigest=${"b".repeat(64)}&operation=activate_inventory`));

    expect(response.status).toBe(200);
    expect(calls.getModelCommandReceipt).toHaveBeenCalledWith({ commandId: "a".repeat(32),
      requestDigest: "b".repeat(64), operation: "activate_inventory" });
  });

  it.each([
    [Code.InvalidArgument, 400], [Code.Unauthenticated, 401], [Code.PermissionDenied, 403], [Code.NotFound, 404],
    [Code.AlreadyExists, 409], [Code.FailedPrecondition, 409], [Code.ResourceExhausted, 429],
    [Code.Unavailable, 503],
  ])("maps typed Model read code %s to HTTP %s", async (connectCode, status) => {
    const { AdminControlPlaneError } = await import("@/lib/control-plane/client");
    calls.getModelInventoryRevision.mockRejectedValueOnce(new AdminControlPlaneError(
      connectCode, "model.inventory.read_failed", "receipt:one",
    ));
    const route = await import("../app/api/control/models/route");
    const response = await route.GET(new Request(
      `https://admin.example/api/control/models?view=inventory&inventoryDigest=${inventoryDigest}`,
    ));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: {
      code: "model.inventory.read_failed",
      receiptRef: "receipt:one",
    } });
  });
});

describe("Model control console boundary", () => {
  const source = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

  it("uses one typed BFF for the entire Model control lifecycle", () => {
    const consoleSource = `${source("app/models/models-console.tsx")}\n${source("app/models/model-control-forms.tsx")}`;

    expect(consoleSource).toContain("/api/control/models");
    expect(consoleSource).not.toContain("/api/resource");
    for (const action of ["import_inventory", "activate_inventory", "materialize_options",
      "change_site_policy", "publish_site_release_catalog"]) {
      expect(consoleSource).toContain(`action: "${action}"`);
    }
    for (const operation of ["model.inventory.import", "model.inventory.activate", "model.option.materialize",
      "model.site-policy.change", "model.site-release-catalog.publish"]) {
      expect(consoleSource).toContain(`operation="${operation}"`);
    }
  });

  it("exposes only provider secret presence and keeps the object-first information architecture", () => {
    const consoleSource = `${source("app/models/models-console.tsx")}\n${source("app/models/model-control-forms.tsx")}`;

    expect(consoleSource).toContain("secretReferencePresent");
    expect(consoleSource).not.toContain("secretRef:");
    for (const label of ["版本", "提供方", "模型目录", "产品选项", "站点发布"]) {
      expect(consoleSource).toContain(`"${label}"`);
    }
  });

  it("renders structured nested editors and an exact inventory detail instead of JSON textareas", () => {
    const consoleSource = `${source("app/models/models-console.tsx")}\n${source("app/models/model-control-forms.tsx")}`;

    expect(consoleSource).toContain("ProFormList");
    expect(consoleSource).toContain("view=inventory");
    expect(consoleSource).not.toContain("JSON 数组");
    expect(consoleSource).not.toContain("JSON.parse");
  });
});
