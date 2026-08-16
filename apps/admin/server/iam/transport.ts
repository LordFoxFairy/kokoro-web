import "server-only";

import { randomUUID } from "node:crypto";

import type { Interceptor, Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";

import type { IamTransportConfig } from "../config/config";

const bearerTokenPattern = /^[A-Za-z0-9._~-]+$/u;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function requestId(message: unknown): string {
  if (!message || typeof message !== "object") return randomUUID();
  const direct: unknown = Reflect.get(message, "requestId");
  if (typeof direct === "string" && requestIdPattern.test(direct)) return direct;
  const command: unknown = Reflect.get(message, "command");
  const nested: unknown = command && typeof command === "object" ? Reflect.get(command, "requestId") : undefined;
  return typeof nested === "string" && requestIdPattern.test(nested) ? nested : randomUUID();
}

function validateToken(value: string, name: string): void {
  if (value.length < 1 || value.length > 4_096 || !bearerTokenPattern.test(value)) {
    throw new Error(`invalid ${name}`);
  }
}

function headers(workloadToken: string, actorToken?: string): Interceptor {
  validateToken(workloadToken, "IAM workload credential");
  if (actorToken !== undefined) validateToken(actorToken, "IAM actor credential");
  return (next) => async (request) => {
    request.header.set("authorization", `Bearer ${workloadToken}`);
    request.header.set("x-kokoro-request-id", requestId(request.message));
    if (actorToken !== undefined) {
      request.header.set("x-kokoro-user-authorization", `Bearer ${actorToken}`);
    }
    return next(request);
  };
}

function transport(config: IamTransportConfig, actorToken?: string): Transport {
  return createConnectTransport({
    baseUrl: config.baseUrl,
    httpVersion: "1.1",
    defaultTimeoutMs: config.timeoutMs,
    writeMaxBytes: config.requestLimitBytes,
    readMaxBytes: config.responseLimitBytes,
    interceptors: [headers(config.workloadToken, actorToken)],
  });
}

export function createWorkloadTransport(config: IamTransportConfig): Transport {
  return transport(config);
}

export function createActorTransport(config: IamTransportConfig, actorToken: string): Transport {
  return transport(config, actorToken);
}
