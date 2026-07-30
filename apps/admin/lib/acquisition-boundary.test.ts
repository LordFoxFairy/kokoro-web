import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../next.config";

const FILTERED_ADMIN_PATHS = [
  "/api/manifests",
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

beforeEach(() => {
  process.env.KOKORO_GATEWAY_URL = "http://gateway.test";
  process.env.KOKORO_ADMIN_PROXY_SECRET = "server-proxy-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KOKORO_GATEWAY_URL;
  delete process.env.KOKORO_ADMIN_PROXY_SECRET;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function adminRequest(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("x-kokoro-operator", "operator@example.com");
  headers.set("x-kokoro-proxy-secret", "server-proxy-secret");
  return new Request(url, { ...init, headers });
}

function chunkStream(chunkCount: number, chunkBytes: number, cancel: () => void): ReadableStream<Uint8Array> {
  let emitted = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= chunkCount) {
        controller.close();
        return;
      }
      emitted += 1;
      controller.enqueue(new Uint8Array(chunkBytes));
    },
    cancel,
  });
}

describe("Admin acquisition boundary direct requests", () => {
  it("filters payment and typed-only Credit manifests while preserving legacy modules", async () => {
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

    const response = await route.GET(adminRequest("https://admin.example/api/manifests"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        { id: "site", online: true, manifest: null },
      ],
      requestId: "req-manifests",
    });
  });

  it("rejects a manual payment resource request without reaching the gateway", async () => {
    const route = await import("../app/api/resource/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await route.GET(
      adminRequest(
        "https://admin.example/api/resource?moduleId=payment&route=%2Fadmin%2Fpayments%2Fplans&siteId=site-a",
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "ACQUISITION_CHANNEL_DISABLED", message: "Acquisition channel is disabled" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a legacy Credit resource request without reaching the gateway", async () => {
    const route = await import("../app/api/resource/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await route.GET(
      adminRequest(
        "https://admin.example/api/resource?moduleId=credit&route=%2Fadmin%2Fcredits%2Faccounts&siteId=site-a",
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "CREDIT_TYPED_BOUNDARY_REQUIRED", message: "Credit is available only through typed control routes" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a manual payment action without reaching the gateway", async () => {
    const route = await import("../app/api/action/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await route.POST(
      adminRequest("https://admin.example/api/action", {
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

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { pendingApproval: false } }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { moduleId: "site", resourceId: "domains", actionId: "bind", siteId: "site-a" };
    const response = await route.POST(
      adminRequest("https://admin.example/api/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("rejects legacy Credit actions and OpenAPI without gateway egress", async () => {
    const action = await import("../app/api/action/route");
    const openapi = await import("../app/api/openapi/[moduleId]/route");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const actionResponse = await action.POST(adminRequest("https://admin.example/api/action", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        moduleId: "credit", resourceId: "credit-accounts", actionId: "grant", siteId: "site-a",
      }),
    }));
    const openApiResponse = await openapi.GET(adminRequest("https://admin.example/api/openapi/credit"),
      { params: Promise.resolve({ moduleId: "credit" }) });
    for (const response of [actionResponse, openApiResponse]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "CREDIT_TYPED_BOUNDARY_REQUIRED", message: "Credit is available only through typed control routes" },
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects spoofed browser trust headers before gateway egress", async () => {
    const route = await import("../app/api/resource/route");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await route.GET(
      new Request("https://admin.example/api/resource?moduleId=credit&route=%2Fadmin%2Fcredits%2Faccounts", {
        headers: {
          "x-kokoro-operator": "attacker@example.com",
          "x-kokoro-proxy-secret": "browser-controlled",
          "x-kokoro-internal-secret": "also-spoofed",
        },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "auth.boundary_unavailable", message: "Admin trust boundary is unavailable" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the server-side proxy secret is missing", async () => {
    delete process.env.KOKORO_ADMIN_PROXY_SECRET;
    const route = await import("../app/api/manifests/route");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await route.GET(adminRequest("https://admin.example/api/manifests"));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deeply allowlists manifest fields instead of relaying acquisition-shaped additions", async () => {
    const route = await import("../app/api/manifests/route");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: [
            {
              id: "credit",
              online: true,
              payments: [{ id: "p1" }],
              manifest: {
                revenue: "secret",
                resources: [
                  {
                    id: "accounts",
                    labelKey: "admin.credit.accounts",
                    route: "/admin/credits/accounts",
                    siteScopeField: "siteId",
                    orders: [{ id: "order-1" }],
                    actions: [
                      {
                        id: "grant",
                        labelKey: "admin.credit.actions.grant",
                        kind: "mutation",
                        requiredPermission: "credit.grant",
                        route: "/admin/credits/grants",
                        refunds: [{ id: "refund-1" }],
                      },
                    ],
                  },
                ],
              },
            },
          ],
          subscriptions: [{ id: "sub-1" }],
          requestId: "req-safe",
        }),
      ),
    );

    const response = await route.GET(adminRequest("https://admin.example/api/manifests"));
    expect(await response.json()).toEqual({ data: [], requestId: "req-safe" });
  });

  it("normalizes non-2xx gateway errors and strips arbitrary fields", async () => {
    const route = await import("../app/api/manifests/route");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          error: { code: "operator.auth", message: "Forbidden", details: { orders: [{ id: "order-1" }] } },
          payments: [{ id: "payment-1" }],
          requestId: "req-error",
        }),
      ),
    );

    const response = await route.GET(adminRequest("https://admin.example/api/manifests"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "operator.auth", message: "Forbidden" },
      requestId: "req-error",
    });
  });

  it("rejects an action by declared Content-Length before reading or fetching", async () => {
    const route = await import("../app/api/action/route");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await route.POST(
      adminRequest("https://admin.example/api/action", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "100000000" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels and rejects an oversized upstream JSON response", async () => {
    const route = await import("../app/api/manifests/route");
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { "content-type": "application/json", "content-length": "100000000" } }),
      ),
    );
    const response = await route.GET(adminRequest("https://admin.example/api/manifests"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "gateway.response_too_large", message: "Admin gateway response exceeds the size limit" },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("enforces the upstream response hard cap when Content-Length is absent", async () => {
    const route = await import("../app/api/manifests/route");
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(chunkStream(100, 1024 * 1024, cancel), { status: 200 })),
    );

    const response = await route.GET(adminRequest("https://admin.example/api/manifests"));
    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("enforces the action request hard cap when Content-Length is absent", async () => {
    const route = await import("../app/api/action/route");
    const cancel = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chunkStream(100, 1024 * 1024, cancel),
      duplex: "half",
    } as RequestInit & { duplex: "half" };

    const response = await route.POST(adminRequest("https://admin.example/api/action", init));
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
