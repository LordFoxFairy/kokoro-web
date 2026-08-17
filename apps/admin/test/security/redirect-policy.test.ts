import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { safeAuthRedirect } from "../../server/auth/redirect";
import { createTrustedAuthHandlers } from "../../server/auth/route";

const baseUrl = "https://admin.kokoro.example";

describe("Auth.js callback and return URL policy", () => {
  it("WEB-SEC-REDIRECT-001 allows only explicit relative control-plane routes", () => {
    expect(safeAuthRedirect("/", baseUrl)).toBe(`${baseUrl}/`);
    expect(safeAuthRedirect("/users?status=active", baseUrl)).toBe(`${baseUrl}/users?status=active`);
    expect(safeAuthRedirect(
      "/organizations/94944258-f6a2-4813-bd2e-3e4a38053021?tab=members",
      baseUrl,
    )).toBe(`${baseUrl}/organizations/94944258-f6a2-4813-bd2e-3e4a38053021?tab=members`);
    expect(safeAuthRedirect("/sites?status=active", baseUrl)).toBe(`${baseUrl}/sites?status=active`);
    expect(safeAuthRedirect(
      "/sites/94944258-f6a2-4813-bd2e-3e4a38053021?tab=access",
      baseUrl,
    )).toBe(`${baseUrl}/sites/94944258-f6a2-4813-bd2e-3e4a38053021?tab=access`);
  });

  it("WEB-SEC-REDIRECT-001 rejects absolute cross-origin scheme-relative and credential URLs", () => {
    const rejected = [
      "https://evil.example/",
      `${baseUrl}/users`,
      "//evil.example/path",
      "https://user:password@admin.kokoro.example/",
      "javascript:alert(1)",
    ];

    for (const value of rejected) expect(safeAuthRedirect(value, baseUrl), value).toBe(`${baseUrl}/`);
  });

  it("WEB-SEC-REDIRECT-001 rejects encoded separators backslashes traversal fragments and unknown routes", () => {
    const rejected = [
      "/%2f%2fevil.example",
      "/users%5cevil",
      "/users/../audit",
      "/users/%2e%2e/audit",
      "/users#secret",
      "/api/auth/session",
      "/login",
      "/unknown",
    ];

    for (const value of rejected) expect(safeAuthRedirect(value, baseUrl), value).toBe(`${baseUrl}/`);
  });

  it("WEB-SEC-REDIRECT-001 fails closed when the configured base URL is not a canonical HTTPS origin", () => {
    expect(safeAuthRedirect("/", "not-a-url")).toBe("/");
    expect(safeAuthRedirect("/", "https://admin.example/path")).toBe("/");
    expect(safeAuthRedirect("/", "http://admin.example")).toBe("/");
  });

  it("WEB-SEC-REDIRECT-001 admits only the configured route host and same-origin POST", async () => {
    const accepted: string[] = [];
    const route = createTrustedAuthHandlers({
      GET: async (request) => {
        accepted.push(request.nextUrl.pathname);
        return new Response("ok");
      },
      POST: async (request) => {
        accepted.push(request.nextUrl.pathname);
        return new Response("ok");
      },
    }, baseUrl);

    expect((await route.GET(new NextRequest(`${baseUrl}/api/auth/session`))).status).toBe(200);
    expect((await route.GET(new NextRequest("https://evil.example/api/auth/session"))).status).toBe(400);
    expect((await route.POST(new NextRequest(`${baseUrl}/api/auth/signin/nodemailer`, {
      method: "POST",
      headers: { origin: baseUrl },
    }))).status).toBe(200);
    expect((await route.POST(new NextRequest(`${baseUrl}/api/auth/signin/nodemailer`, {
      method: "POST",
    }))).status).toBe(400);
    expect((await route.POST(new NextRequest(`${baseUrl}/api/auth/signin/nodemailer`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    }))).status).toBe(400);
    expect(accepted).toEqual(["/api/auth/session", "/api/auth/signin/nodemailer"]);
  });
});
