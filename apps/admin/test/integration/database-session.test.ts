import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createClient, createRouterTransport } from "@connectrpc/connect";
import type { Session } from "next-auth";
import { afterEach, describe, expect, it } from "vitest";

import { IamSessionService } from "../../generated/iam/proto/kokoro/iam/v1/session_pb";
import type { AdminRuntimeConfig } from "../../server/config/config";
import { createAdminSessionBoundary } from "../../server/auth/session-boundary";
import { createIamSessionClient } from "../../server/iam/session-client";

const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const organizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const sessionToken = "session-token-with-at-least-thirty-two-bytes";
const actorToken = "header.payload.signature";
const expiresAt = new Date("2026-08-16T04:00:00.000Z");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

describe("Auth.js database Session actor exchange", () => {
  it("WEB-INT-SESSION-001 exchanges the configured opaque cookie then uses one ephemeral actor transport", async () => {
    const issued: Array<Readonly<{ requestId: string; sessionToken: string; organizationId?: string }>> = [];
    const workloadTransport = createRouterTransport((router) => {
      router.service(IamSessionService, {
        issueAccessToken(request) {
          issued.push(request);
          return { accessToken: actorToken, expiresAt: timestampFromDate(expiresAt) };
        },
      });
    });
    const received: IncomingHttpHeaders[] = [];
    const baseUrl = await listen((headers, respond) => {
      received.push(headers);
      respond();
    });
    const config = runtimeConfig(baseUrl);
    const boundary = createAdminSessionBoundary({
      config,
      loadSession: async () => adminSession(),
      loadCookies: async () => ({
        get: (name) => name === "kokoro.admin.session-token" ? { value: sessionToken } : undefined,
      }),
      sessionClient: createIamSessionClient(workloadTransport),
    });

    const actor = await boundary.requireIamActor(organizationId);
    await createClient(IamSessionService, actor.transport).listSessions({
      requestId: "8deecb20-8d72-4b7e-a719-722a2e606728",
    });

    expect(actor.session).toEqual(adminSession());
    expect(actor.expiresAt).toEqual(expiresAt);
    expect(actor).not.toHaveProperty("accessToken");
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ sessionToken, organizationId });
    expect(issued[0]?.requestId).toMatch(uuid);
    expect(received).toHaveLength(1);
    expect(received[0]?.authorization).toBe(`Bearer ${"a".repeat(64)}`);
    expect(received[0]?.["x-kokoro-user-authorization"]).toBe(`Bearer ${actorToken}`);
  });

  it("WEB-INT-SESSION-001 rejects missing inactive and non-admin Sessions before actor exchange", async () => {
    let exchanges = 0;
    const sessionClient = {
      async issueAccessToken(): Promise<{ accessToken: string; expiresAt: Date }> {
        exchanges += 1;
        return { accessToken: actorToken, expiresAt };
      },
    };
    const cases: Array<Session | null> = [
      null,
      { ...adminSession(), user: { ...adminSession().user, platformRole: "user" } },
      { ...adminSession(), user: { ...adminSession().user, status: "suspended" } },
      { ...adminSession(), user: { ...adminSession().user, status: "deleted" } },
    ];

    for (const session of cases) {
      const boundary = createAdminSessionBoundary({
        config: runtimeConfig("http://127.0.0.1:1"),
        loadSession: async () => session,
        loadCookies: async () => ({ get: () => ({ value: sessionToken }) }),
        sessionClient,
      });
      await expect(boundary.requireAdminSession()).rejects.toThrow("admin authentication required");
      await expect(boundary.requireIamActor()).rejects.toThrow("admin authentication required");
    }
    expect(exchanges).toBe(0);
  });

  it("WEB-INT-SESSION-001 rejects a missing cookie and malformed token response without exposing either token", async () => {
    const config = runtimeConfig("http://127.0.0.1:1");
    const missingCookie = createAdminSessionBoundary({
      config,
      loadSession: async () => adminSession(),
      loadCookies: async () => ({ get: () => undefined }),
      sessionClient: {
        issueAccessToken: async () => ({ accessToken: actorToken, expiresAt }),
      },
    });
    await expect(missingCookie.requireIamActor()).rejects.toThrow("admin authentication required");

    const malformedTransport = createRouterTransport((router) => {
      router.service(IamSessionService, {
        issueAccessToken: () => ({ accessToken: "contains whitespace", expiresAt: timestampFromDate(expiresAt) }),
      });
    });
    const malformed = createAdminSessionBoundary({
      config,
      loadSession: async () => adminSession(),
      loadCookies: async () => ({ get: () => ({ value: sessionToken }) }),
      sessionClient: createIamSessionClient(malformedTransport),
    });
    let message = "";
    try {
      await malformed.requireIamActor();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("invalid IAM IssueAccessTokenResponse");
    expect(message).not.toContain(sessionToken);
    expect(message).not.toContain("contains whitespace");
  });
});

function adminSession(): Session {
  return {
    expires: expiresAt.toISOString(),
    user: {
      id: userId,
      email: "admin@example.com",
      name: "Admin",
      image: null,
      platformRole: "admin",
      status: "active",
    },
  };
}

function runtimeConfig(baseUrl: string): AdminRuntimeConfig {
  return {
    mode: "test",
    auth: {
      url: "http://127.0.0.1:3100",
      secret: "s".repeat(64),
      secureCookies: false,
    },
    iam: {
      baseUrl,
      workloadToken: "a".repeat(64),
      requestLimitBytes: 64 * 1_024,
      responseLimitBytes: 1_024 * 1_024,
      timeoutMs: 15_000,
    },
    magicLinkMaxAgeSeconds: 600,
    smtp: {
      from: "no-reply@kokoro.local",
      host: "127.0.0.1",
      port: 1025,
      auth: null,
    },
  };
}

async function listen(
  handle: (headers: IncomingHttpHeaders, respond: () => void) => void,
): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => handle(request.headers, () => {
      response.writeHead(200, { "content-type": "application/proto" });
      response.end(new Uint8Array());
    }));
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test listener did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
}
