import { once } from "node:events";
import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { probeAdminHttp } from "../../scripts/test/smoke-runtime";

describe("production-shaped Admin HTTP probes", () => {
  it("WEB-INT-SMOKE-001 requires public login headers and protected redirect behavior", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/users") {
        response.writeHead(307, { location: "/login" });
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
      });
      response.end("<h1>Operations console sign in</h1>");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("fixture listener missing");
    try {
      const result = await probeAdminHttp(`http://127.0.0.1:${String(address.port)}`);
      expect(result.login).toMatchObject({ status: 200, secureHeaders: true });
      expect(result.protectedRoute).toEqual({ status: 307, location: "/login" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
