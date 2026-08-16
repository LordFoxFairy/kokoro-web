import type { Session } from "next-auth";
import { describe, expect, it } from "vitest";

import { createAdminSessionBoundary } from "../../server/auth/session-boundary";
import type { AdminRuntimeConfig } from "../../server/config/config";

describe("protected Admin route authorization", () => {
  it("WEB-SEC-ROUTE-001 rejects absent stale and non-admin sessions before cookie or IAM access", async () => {
    let cookieReads = 0;
    let exchanges = 0;
    for (const session of [null, userSession("user", "active"), userSession("admin", "suspended")]) {
      const boundary = createAdminSessionBoundary({
        config: config(),
        loadSession: async () => session,
        loadCookies: async () => {
          cookieReads += 1;
          return { get: () => ({ value: "opaque-session-token-with-at-least-32-bytes" }) };
        },
        sessionClient: {
          issueAccessToken: async () => {
            exchanges += 1;
            return { accessToken: "header.payload.signature", expiresAt: new Date(Date.now() + 60_000) };
          },
        },
      });
      await expect(boundary.requireIamActor()).rejects.toThrow("admin authentication required");
    }
    expect(cookieReads).toBe(0);
    expect(exchanges).toBe(0);
  });
});

function userSession(platformRole: "user" | "admin", status: "active" | "suspended"): Session {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "bce7762a-f7c7-4d22-8031-4336803038eb",
      email: "admin@example.com",
      name: "Admin",
      image: null,
      platformRole,
      status,
    },
  };
}

function config(): AdminRuntimeConfig {
  return {
    mode: "test",
    auth: { url: "http://127.0.0.1:3100", secret: "s".repeat(64), secureCookies: false },
    iam: {
      baseUrl: "http://127.0.0.1:4100",
      workloadToken: "a".repeat(64),
      requestLimitBytes: 64 * 1_024,
      responseLimitBytes: 1_024 * 1_024,
      timeoutMs: 15_000,
    },
    magicLinkMaxAgeSeconds: 600,
    smtp: { from: "no-reply@kokoro.local", host: "127.0.0.1", port: 1025, auth: null },
  };
}
