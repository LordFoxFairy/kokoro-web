import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function trustedRequest(moduleId: string): Request {
  return new Request(`https://admin.example/api/openapi/${moduleId}`, {
    headers: {
      accept: "application/json",
      "x-kokoro-operator": "operator@example.com",
      "x-kokoro-proxy-secret": "server-proxy-secret",
    },
  });
}

function routeContext(moduleId: string): { params: Promise<{ moduleId: string }> } {
  return { params: Promise.resolve({ moduleId }) };
}

function jsonResponse(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
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

beforeEach(() => {
  process.env.KOKORO_GATEWAY_URL = "http://gateway.test";
  process.env.KOKORO_ADMIN_PROXY_SECRET = "server-proxy-secret";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.KOKORO_GATEWAY_URL;
  delete process.env.KOKORO_ADMIN_PROXY_SECRET;
});

describe("Admin OpenAPI BFF boundary", () => {
  it("serves an allowlisted module through the authenticated fixed gateway route", async () => {
    const document = { openapi: "3.0.3", info: { title: "Sites", version: "1" }, paths: {} };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, document, { "content-disposition": 'attachment; filename="attacker.json"' }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const route = await import("../app/api/openapi/[moduleId]/route");

    const response = await route.GET(trustedRequest("site"), routeContext("site"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/u);
    expect(response.headers.get("content-disposition")).toBe('inline; filename="site-openapi.json"');
    expect(await response.json()).toEqual(document);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe("http://gateway.test/api/openapi/site");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "manual" });
    const headers = init.headers as Headers;
    expect(headers.get("x-kokoro-operator")).toBe("operator@example.com");
    expect(headers.get("x-kokoro-proxy-secret")).toBe("server-proxy-secret");
  });

  it.each([
    ["payment", 404, "ACQUISITION_CHANNEL_DISABLED"],
    ["unknown", 400, "request.invalid"],
    ["SITE", 400, "request.invalid"],
    ["../site", 400, "request.invalid"],
  ] as const)("rejects non-allowlisted module %s before gateway egress", async (moduleId, status, code) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getFilteredOpenApi } = await import("./admin-gateway");

    const response = await getFilteredOpenApi(trustedRequest("site"), moduleId);

    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires the trusted Auth.js boundary before revealing the module allowlist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getFilteredOpenApi } = await import("./admin-gateway");
    const request = new Request("https://admin.example/api/openapi/site", {
      headers: { "x-kokoro-operator": "spoofed@example.com" },
    });

    const response = await getFilteredOpenApi(request, "site");

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("auth.boundary_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves docs.read authorization with Platform and preserves its typed denial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          error: { code: "operator.auth", message: "No docs access", details: { private: true } },
          requestId: "request-docs",
          private: "must-not-cross",
        }),
      ),
    );
    const { getFilteredOpenApi } = await import("./admin-gateway");

    const response = await getFilteredOpenApi(trustedRequest("site"), "site");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "operator.auth", message: "No docs access" },
      requestId: "request-docs",
    });
  });

  it("fails closed on a declared oversized document and cancels its body", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "3000000" },
        }),
      ),
    );
    const { getFilteredOpenApi } = await import("./admin-gateway");

    const response = await getFilteredOpenApi(trustedRequest("site"), "site");

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("gateway.response_too_large");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("enforces the streaming cap when Content-Length is absent", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(chunkStream(100, 1024 * 1024, cancel), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const { getFilteredOpenApi } = await import("./admin-gateway");

    const response = await getFilteredOpenApi(trustedRequest("site"), "site");

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("gateway.response_too_large");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong media type", new Response("{}", { headers: { "content-type": "text/html" } })],
    ["invalid JSON", new Response("not-json", { headers: { "content-type": "application/json" } })],
    ["not OpenAPI", jsonResponse(200, { value: "not-a-contract" })],
  ])("rejects %s instead of publishing an unverified descriptor", async (_name, upstream) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));
    const { getFilteredOpenApi } = await import("./admin-gateway");

    const response = await getFilteredOpenApi(trustedRequest("site"), "site");

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("gateway.bad_response");
  });

  it("aborts a slow gateway and returns a stable timeout taxonomy", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_input, init) => {
        signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }),
    );
    const { getFilteredOpenApi } = await import("./admin-gateway");

    const responsePromise = getFilteredOpenApi(trustedRequest("site"), "site");
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await responsePromise;

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: { code: "gateway.timeout", message: "Admin gateway request timed out" },
    });
    expect(signal?.aborted).toBe(true);
  });
});
