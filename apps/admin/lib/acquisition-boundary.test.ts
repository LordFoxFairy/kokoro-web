import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../next.config";

const FILTERED_ADMIN_PATHS = [
  "/api/manifests",
  "/api/billing-overview",
  "/api/user360",
  "/api/resource",
  "/api/action",
] as const;

describe("Admin acquisition boundary topology", () => {
  it("never sends filtered Admin endpoints through direct external rewrites", async () => {
    const rewrites = await nextConfig.rewrites?.();
    expect(rewrites).toBeDefined();
    const sources = Array.isArray(rewrites)
      ? rewrites.map((rewrite) => rewrite.source)
      : [...(rewrites?.beforeFiles ?? []), ...(rewrites?.afterFiles ?? []), ...(rewrites?.fallback ?? [])].map(
          (rewrite) => rewrite.source,
        );

    for (const path of FILTERED_ADMIN_PATHS) expect(sources).not.toContain(path);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KOKORO_GATEWAY_URL;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Admin acquisition boundary direct requests", () => {
  it("filters the payment manifest while preserving other modules", async () => {
    const route = await import("../app/api/manifests/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;

    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [
          { id: "site", online: true, manifest: null },
          { id: "payment", online: true, manifest: { resources: [] } },
          { id: "credit", online: true, manifest: null },
        ],
        requestId: "req-manifests",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await route.GET(new Request("https://admin.example/api/manifests"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        { id: "site", online: true, manifest: null },
        { id: "credit", online: true, manifest: null },
      ],
      requestId: "req-manifests",
    });
  });

  it("strips payment metrics from billing overview while preserving credit metrics", async () => {
    const route = await import("../app/api/billing-overview/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;

    const credit = { accountsTotal: 2, accountsActive: 1 };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: { credit, payment: { ordersPaid: 99, revenueByCurrency: [{ currency: "USD", amountMinor: "100" }] } },
        requestId: "req-overview",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await route.GET(
      new Request("https://admin.example/api/billing-overview?siteId=site-a"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { credit }, requestId: "req-overview" });
  });

  it("strips orders from user360 while preserving identity and credit account data", async () => {
    const route = await import("../app/api/user360/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;

    const identity = { id: "user-1", email: "user@example.com" };
    const creditAccount = { id: "credit-1", balanceMicros: "10000", heldMicros: "0", status: "active" };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          identity,
          creditAccount,
          orders: [{ id: "order-1", status: "paid", amountMinor: "100" }],
        },
        requestId: "req-user360",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await route.GET(
      new Request("https://admin.example/api/user360?siteId=site-a&ownerKind=team&ownerId=team-1"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { identity, creditAccount },
      requestId: "req-user360",
    });
  });

  it("rejects a manual payment resource request without reaching the gateway", async () => {
    const route = await import("../app/api/resource/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await route.GET(
      new Request(
        "https://admin.example/api/resource?moduleId=payment&route=%2Fadmin%2Fpayments%2Fplans&siteId=site-a",
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "ACQUISITION_CHANNEL_DISABLED", message: "Acquisition channel is disabled" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies a non-payment resource request with its operator boundary headers", async () => {
    const route = await import("../app/api/resource/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;

    process.env.KOKORO_GATEWAY_URL = "http://gateway.test";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: "credit-1" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await route.GET(
      new Request(
        "https://admin.example/api/resource?moduleId=credit&route=%2Fadmin%2Fcredits%2Faccounts&siteId=site-a",
        { headers: { "x-kokoro-operator": "operator@example.com", "x-kokoro-proxy-secret": "proxy-secret" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ id: "credit-1" }] });
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe(
      "http://gateway.test/api/resource?moduleId=credit&route=%2Fadmin%2Fcredits%2Faccounts&siteId=site-a",
    );
    const headers = init.headers as Headers;
    expect(headers.get("x-kokoro-operator")).toBe("operator@example.com");
    expect(headers.get("x-kokoro-proxy-secret")).toBe("proxy-secret");
  });

  it("rejects a manual payment action without reaching the gateway", async () => {
    const route = await import("../app/api/action/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await route.POST(
      new Request("https://admin.example/api/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moduleId: "payment", resourceId: "orders", actionId: "refund", siteId: "site-a" }),
      }),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies a non-payment action without changing its body", async () => {
    const route = await import("../app/api/action/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;

    process.env.KOKORO_GATEWAY_URL = "http://gateway.test";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { pendingApproval: false } }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { moduleId: "site", resourceId: "domains", actionId: "bind", siteId: "site-a" };
    const response = await route.POST(
      new Request("https://admin.example/api/action", {
        method: "POST",
        headers: { "content-type": "application/json", "x-kokoro-operator": "operator@example.com" },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(body);
  });
});
