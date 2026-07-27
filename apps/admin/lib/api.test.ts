import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, UNKNOWN_ERROR_CODE, apiGet, queryString } from "./api";

// 只桩 fetch：node 环境下相对路径无法被真实 fetch 解析，且这里要断言的是信封解析而非网络。
function stubResponse(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("queryString", () => {
  it("encodes resource route and selected siteId deterministically", () => {
    expect(
      queryString({
        moduleId: "payment",
        route: "/admin/payments/plans",
        siteId: "site-demo",
      }),
    ).toBe("moduleId=payment&route=%2Fadmin%2Fpayments%2Fplans&siteId=site-demo");
  });
});

describe("ApiError", () => {
  it("keeps the domain error code instead of collapsing the envelope into a message", async () => {
    stubResponse(403, { error: { code: "operator.auth", message: "无权查看操作员列表" } });
    const err = await apiGet("/api/operators", z.unknown()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const api = err as ApiError;
    expect(api.status).toBe(403);
    expect(api.code).toBe("operator.auth");
    expect(api.message).toBe("无权查看操作员列表");
    expect(api.details).toBeUndefined();
    expect(api.requestId).toBeUndefined();
  });

  it("carries details and requestId when the gateway sends them", async () => {
    stubResponse(400, {
      error: { code: "request.invalid", message: "参数校验失败", details: { issues: [{ code: "invalid_type" }] } },
      requestId: "req-1",
    });
    const api = (await apiGet("/api/audit", z.unknown()).catch((e: unknown) => e)) as ApiError;
    expect(api.code).toBe("request.invalid");
    expect(api.details).toEqual({ issues: [{ code: "invalid_type" }] });
    expect(api.requestId).toBe("req-1");
  });

  it("accepts codes outside the contract's current set so a new backend code cannot break the UI", async () => {
    stubResponse(401, { error: { code: "auth.unauthenticated", message: "未登录" } });
    const api = (await apiGet("/api/me", z.unknown()).catch((e: unknown) => e)) as ApiError;
    expect(api.code).toBe("auth.unauthenticated");
  });

  it("falls back to an explicit unknown code when the body is not the error envelope", async () => {
    // 网关未挂 registerErrorHandler 时的 Fastify 默认形状：error 是字符串，不是信封。
    stubResponse(500, { statusCode: 500, error: "Internal Server Error", message: "P2025" });
    const api = (await apiGet("/api/me", z.unknown()).catch((e: unknown) => e)) as ApiError;
    expect(api.code).toBe(UNKNOWN_ERROR_CODE);
    expect(api.message).toBe("HTTP 500");
  });
});
