import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { afterEach, describe, expect, it } from "vitest";

import { IamSessionService } from "../../generated/iam/proto/kokoro/iam/v1/session_pb";
import type { IamTransportConfig } from "../../server/config/config";
import { createActorTransport, createWorkloadTransport } from "../../server/iam/transport";

const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const workloadToken = "a".repeat(64);
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

describe("IAM Node transport", () => {
  it("WEB-UNIT-CONFIG-001 sends workload request-id and actor credentials only from server transport", async () => {
    const received: IncomingHttpHeaders[] = [];
    const baseUrl = await listen((headers, respond) => {
      received.push(headers);
      respond(200, new Uint8Array());
    });
    const config = transportConfig(baseUrl);

    await createClient(IamSessionService, createWorkloadTransport(config)).listSessions({ requestId });
    await createClient(IamSessionService, createActorTransport(config, "actor-token")).listSessions({ requestId });

    expect(received).toHaveLength(2);
    expect(received[0]?.authorization).toBe(`Bearer ${workloadToken}`);
    expect(received[0]?.["x-kokoro-request-id"]).toBe(requestId);
    expect(received[0]?.["x-kokoro-user-authorization"]).toBeUndefined();
    expect(received[1]?.authorization).toBe(`Bearer ${workloadToken}`);
    expect(received[1]?.["x-kokoro-request-id"]).toBe(requestId);
    expect(received[1]?.["x-kokoro-user-authorization"]).toBe("Bearer actor-token");
  });

  it("WEB-UNIT-CONFIG-001 enforces request response and deadline bounds at the real Node transport", async () => {
    const requestBaseUrl = await listen((_headers, respond) => {
      respond(200, new Uint8Array());
    });
    const requestClient = createClient(IamSessionService, createWorkloadTransport({
      ...transportConfig(requestBaseUrl),
      requestLimitBytes: 32,
    }));

    await expect(requestClient.listSessions({ requestId, userId: "x".repeat(256) })).rejects.toMatchObject({
      code: Code.ResourceExhausted,
    });

    const oversizedBaseUrl = await listen((_headers, respond) => {
      respond(200, new Uint8Array(256));
    });
    const oversizedClient = createClient(IamSessionService, createWorkloadTransport({
      ...transportConfig(oversizedBaseUrl),
      responseLimitBytes: 32,
    }));

    await expect(oversizedClient.listSessions({ requestId })).rejects.toMatchObject({
      code: Code.ResourceExhausted,
    });

    const timeoutBaseUrl = await listen(() => {});
    const timeoutClient = createClient(IamSessionService, createWorkloadTransport({
      ...transportConfig(timeoutBaseUrl),
      timeoutMs: 25,
    }));

    await expect(timeoutClient.listSessions({ requestId })).rejects.toSatisfy((error: unknown) =>
      error instanceof ConnectError && error.code === Code.DeadlineExceeded,
    );
  });

  it("WEB-UNIT-CONFIG-001 rejects malformed bearer credentials before sending a request", () => {
    const config = transportConfig("http://127.0.0.1:1");

    expect(() => createWorkloadTransport({ ...config, workloadToken: "contains whitespace" }))
      .toThrow("invalid IAM workload credential");
    expect(() => createActorTransport(config, "line\nbreak"))
      .toThrow("invalid IAM actor credential");
  });
});

function transportConfig(baseUrl: string): IamTransportConfig {
  return {
    baseUrl,
    workloadToken,
    requestLimitBytes: 64 * 1_024,
    responseLimitBytes: 1_024 * 1_024,
    timeoutMs: 15_000,
  };
}

async function listen(
  handle: (headers: IncomingHttpHeaders, respond: (status: number, body: Uint8Array) => void) => void,
): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => handle(request.headers, (status, body) => {
      response.writeHead(status, { "content-type": "application/proto" });
      response.end(body);
    }));
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test listener did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
}
