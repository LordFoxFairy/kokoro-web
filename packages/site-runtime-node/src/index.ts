import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Agent, request as httpsRequest, type RequestOptions } from "node:https";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { Readable } from "node:stream";

import type {
  AuthenticatedSessionBrowserV3HttpPort,
  OpaqueAuthSession,
  SessionBrowserV3HttpRequest,
  SiteDeploymentBinding,
} from "@kokoro/bff-runtime";
import type {
  PlatformPublicOperationId,
  PlatformPublicRequest,
  PlatformPublicTransport,
} from "@kokoro/site-client/server";

const PLATFORM_BODY_LIMIT = 2 * 1024 * 1024;
const SECRET_FILE_LIMIT = 1024 * 1024;
const REGISTRY = Symbol.for("kokoro.site-runtime-node.provider.v1");

export class NodeSiteRuntimeError extends Error {
  constructor(readonly code: "CONFIG_INVALID" | "TLS_MATERIAL_INVALID" | "UPSTREAM_TIMEOUT" | "UPSTREAM_PROTOCOL_INVALID") {
    super(`Node Site runtime unavailable: ${code}`);
    this.name = "NodeSiteRuntimeError";
  }
}

export interface NodeSiteRuntimeConfig {
  readonly platformOrigin: string;
  readonly sessionOrigin: string;
  readonly platformCsrfToken: string;
  readonly browserCsrfSecret: string;
  readonly upstreamTimeoutMs: number;
  readonly browserCsrfTtlSeconds: number;
}

export interface NodeSiteRuntimeTls {
  readonly certificate: Buffer;
  readonly privateKey: Buffer;
  readonly certificateAuthority: Buffer;
}

export interface NodeSiteRuntimeProvider {
  platformTransport(input: Readonly<{ binding: SiteDeploymentBinding; authSession?: OpaqueAuthSession }>): PlatformPublicTransport;
  sessionHttp(input: Readonly<{ binding: SiteDeploymentBinding }>): AuthenticatedSessionBrowserV3HttpPort;
  platformCsrfToken(): string;
  issueBrowserCsrf(): string;
  verifyBrowserCsrf(input: Readonly<{ operationId: string; token: string }>): boolean;
  close(): void;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new NodeSiteRuntimeError("CONFIG_INVALID");
  return value;
}

function origin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new NodeSiteRuntimeError("CONFIG_INVALID");
  }
  if (
    parsed.protocol !== "https:" || parsed.origin !== value || parsed.username !== "" || parsed.password !== "" ||
    parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== ""
  ) throw new NodeSiteRuntimeError("CONFIG_INVALID");
  return parsed.origin;
}

function credential(value: string, minimum = 32, maximum = 4096): string {
  if (
    value.length < minimum || value.length > maximum ||
    Array.from(value).some((character) => (character.codePointAt(0) ?? 0) <= 32)
  ) throw new NodeSiteRuntimeError("CONFIG_INVALID");
  return value;
}

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (raw === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) throw new NodeSiteRuntimeError("CONFIG_INVALID");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new NodeSiteRuntimeError("CONFIG_INVALID");
  }
  return value;
}

function secretFile(env: NodeJS.ProcessEnv, name: string, kind: "certificate" | "private_key"): Buffer {
  const path = required(env, name);
  if (!isAbsolute(path)) throw new NodeSiteRuntimeError("TLS_MATERIAL_INVALID");
  try {
    const metadata = statSync(path);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > SECRET_FILE_LIMIT) {
      throw new NodeSiteRuntimeError("TLS_MATERIAL_INVALID");
    }
    const contents = readFileSync(path);
    if (contents.byteLength < 1 || contents.byteLength > SECRET_FILE_LIMIT) {
      throw new NodeSiteRuntimeError("TLS_MATERIAL_INVALID");
    }
    const pem = contents.toString("ascii");
    const validPem = kind === "certificate"
      ? /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/u.test(pem)
      : /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----[\s\S]+-----END (?:EC |RSA )?PRIVATE KEY-----/u.test(pem);
    if (!validPem) throw new NodeSiteRuntimeError("TLS_MATERIAL_INVALID");
    return contents;
  } catch (error) {
    if (error instanceof NodeSiteRuntimeError) throw error;
    throw new NodeSiteRuntimeError("TLS_MATERIAL_INVALID");
  }
}

export function loadNodeSiteRuntime(input: NodeJS.ProcessEnv = process.env): Readonly<{
  config: NodeSiteRuntimeConfig;
  tls: NodeSiteRuntimeTls;
}> {
  return Object.freeze({
    config: Object.freeze({
      platformOrigin: origin(required(input, "KOKORO_SITE_RUNTIME_PLATFORM_ORIGIN")),
      sessionOrigin: origin(required(input, "KOKORO_SITE_RUNTIME_SESSION_ORIGIN")),
      platformCsrfToken: credential(required(input, "KOKORO_PLATFORM_CSRF_TOKEN"), 32, 512),
      browserCsrfSecret: credential(required(input, "KOKORO_BROWSER_CSRF_SECRET"), 32, 4096),
      upstreamTimeoutMs: boundedInteger(input.KOKORO_SITE_UPSTREAM_TIMEOUT_MS, 10_000, 100, 60_000),
      browserCsrfTtlSeconds: boundedInteger(input.KOKORO_BROWSER_CSRF_TTL_SECONDS, 900, 60, 3_600),
    }),
    tls: Object.freeze({
      certificate: secretFile(input, "KOKORO_SITE_RUNTIME_MTLS_CERT_FILE", "certificate"),
      privateKey: secretFile(input, "KOKORO_SITE_RUNTIME_MTLS_KEY_FILE", "private_key"),
      certificateAuthority: secretFile(input, "KOKORO_SITE_RUNTIME_MTLS_CA_FILE", "certificate"),
    }),
  });
}

function queryString(value: unknown): string {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new NodeSiteRuntimeError("UPSTREAM_PROTOCOL_INVALID");
  }
  const query = new URLSearchParams();
  for (const [name, raw] of Object.entries(value as Readonly<Record<string, unknown>>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (raw === undefined) continue;
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
      throw new NodeSiteRuntimeError("UPSTREAM_PROTOCOL_INVALID");
    }
    query.set(name, String(raw));
  }
  const rendered = query.toString();
  return rendered === "" ? "" : `?${rendered}`;
}

function responseHeaders(input: IncomingHttpHeaders): Headers {
  const output = new Headers();
  for (const [name, raw] of Object.entries(input)) {
    if (raw === undefined) continue;
    if (Array.isArray(raw)) for (const value of raw) output.append(name, value);
    else output.set(name, raw);
  }
  return output;
}

function openHttps(input: Readonly<{
  origin: string;
  agent: Agent;
  method: string;
  path: string;
  headers: Readonly<Record<string, string>>;
  body: string | null;
  signal?: AbortSignal;
  timeoutMs: number;
}>): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const options: RequestOptions = {
      agent: input.agent,
      method: input.method,
      path: input.path,
      headers: input.headers,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    const request = httpsRequest(new URL(input.origin), options, (response) => {
      settled = true;
      clearTimeout(timer);
      resolve(response);
    });
    const timer = setTimeout(() => request.destroy(new NodeSiteRuntimeError("UPSTREAM_TIMEOUT")), input.timeoutMs);
    timer.unref();
    request.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) reject(error);
    });
    request.end(input.body ?? undefined);
  });
}

async function boundedJson(response: IncomingMessage, timeoutMs: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  const timer = setTimeout(() => response.destroy(new NodeSiteRuntimeError("UPSTREAM_TIMEOUT")), timeoutMs);
  timer.unref();
  try {
    for await (const raw of response) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
      size += chunk.byteLength;
      if (size > PLATFORM_BODY_LIMIT) {
        response.destroy(new NodeSiteRuntimeError("UPSTREAM_PROTOCOL_INVALID"));
        throw new NodeSiteRuntimeError("UPSTREAM_PROTOCOL_INVALID");
      }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof NodeSiteRuntimeError) throw error;
    throw new NodeSiteRuntimeError("UPSTREAM_PROTOCOL_INVALID");
  } finally {
    clearTimeout(timer);
  }
}

function assertPlatformMediaType(response: IncomingMessage): void {
  const raw = response.headers["content-type"];
  const mediaType = typeof raw === "string" ? raw.split(";", 1)[0]?.trim().toLowerCase() : undefined;
  if (mediaType === "application/json" || mediaType === "application/problem+json") return;
  response.destroy(new NodeSiteRuntimeError("UPSTREAM_PROTOCOL_INVALID"));
  throw new NodeSiteRuntimeError("UPSTREAM_PROTOCOL_INVALID");
}

function csrf(input: Readonly<{
  secret: string;
  ttlSeconds: number;
  now: () => number;
  nonce: () => Buffer;
}>) {
  const signature = (payload: string): Buffer => createHmac("sha256", input.secret).update(payload).digest();
  return Object.freeze({
    issue(): string {
      const payload = `v1.${Math.floor(input.now() / 1_000) + input.ttlSeconds}.${input.nonce().toString("base64url")}`;
      return `${payload}.${signature(payload).toString("base64url")}`;
    },
    verify(token: string): boolean {
      const segments = token.split(".");
      if (
        segments.length !== 4 || segments[0] !== "v1" || !/^[1-9][0-9]{9,12}$/u.test(segments[1] ?? "") ||
        !/^[A-Za-z0-9_-]{32}$/u.test(segments[2] ?? "") || !/^[A-Za-z0-9_-]{43}$/u.test(segments[3] ?? "")
      ) return false;
      const expiresAt = Number(segments[1]);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(input.now() / 1_000)) return false;
      const payload = segments.slice(0, 3).join(".");
      let actual: Buffer;
      try {
        actual = Buffer.from(segments[3] ?? "", "base64url");
      } catch {
        return false;
      }
      const expected = signature(payload);
      return actual.toString("base64url") === segments[3] && actual.length === expected.length && timingSafeEqual(actual, expected);
    },
  });
}

export function createNodeSiteRuntimeProvider(input: Readonly<{
  config: NodeSiteRuntimeConfig;
  tls: NodeSiteRuntimeTls;
  now?: () => number;
  nonce?: () => Buffer;
}>): Readonly<NodeSiteRuntimeProvider> {
  const agent = new Agent({
    keepAlive: true,
    maxSockets: 64,
    maxFreeSockets: 16,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    rejectUnauthorized: true,
    cert: input.tls.certificate,
    key: input.tls.privateKey,
    ca: input.tls.certificateAuthority,
  });
  const browserCsrf = csrf({
    secret: input.config.browserCsrfSecret,
    ttlSeconds: input.config.browserCsrfTtlSeconds,
    now: input.now ?? Date.now,
    nonce: input.nonce ?? (() => randomBytes(24)),
  });
  const provider: NodeSiteRuntimeProvider = {
    platformTransport(runtimeInput) {
      const { authSession } = runtimeInput;
      return Object.freeze({
        async execute<Operation extends PlatformPublicOperationId>(request: PlatformPublicRequest<Operation>) {
          if (!request.path.startsWith("/") || request.path.startsWith("//")) {
            throw new NodeSiteRuntimeError("UPSTREAM_PROTOCOL_INVALID");
          }
          const body = request.body === undefined ? null : JSON.stringify(request.body);
          const headers: Record<string, string> = {
            ...request.headers,
            accept: "application/json",
            ...(body === null ? {} : { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }),
            ...(authSession === undefined ? {} : { authorization: `Bearer ${authSession.sessionCredential}` }),
            ...(request.security.receiptRecoveryCapability === undefined ? {} : {
              "x-kokoro-receipt-recovery-capability": request.security.receiptRecoveryCapability,
            }),
          };
          const response = await openHttps({
            origin: input.config.platformOrigin,
            agent,
            method: request.method,
            path: `${request.path}${queryString(request.query)}`,
            headers,
            body,
            timeoutMs: input.config.upstreamTimeoutMs,
          });
          assertPlatformMediaType(response);
          return Object.freeze({ status: response.statusCode ?? 502, body: await boundedJson(response, input.config.upstreamTimeoutMs) });
        },
      }) as PlatformPublicTransport;
    },
    sessionHttp(runtimeInput) {
      const { binding } = runtimeInput;
      return Object.freeze({
        async send(request: SessionBrowserV3HttpRequest) {
          if (!request.pathname.startsWith("/") || request.pathname.startsWith("//") || request.query.startsWith("?")) {
            throw new NodeSiteRuntimeError("UPSTREAM_PROTOCOL_INVALID");
          }
          const headers: Record<string, string> = {
            ...request.headers,
            authorization: `${request.authorization.scheme} ${request.authorization.credential}`,
            "x-kokoro-workload-credential": binding.workloadCredential,
            ...(request.body === null ? {} : { "content-length": String(Buffer.byteLength(request.body)) }),
          };
          const response = await openHttps({
            origin: input.config.sessionOrigin,
            agent,
            method: request.method,
            path: `${request.pathname}${request.query === "" ? "" : `?${request.query}`}`,
            headers,
            body: request.body,
            signal: request.signal,
            timeoutMs: input.config.upstreamTimeoutMs,
          });
          return Object.freeze({
            status: response.statusCode ?? 502,
            headers: responseHeaders(response.headers),
            body: Readable.toWeb(response) as ReadableStream<Uint8Array>,
            authenticatedBinding: request.expectedBinding,
          });
        },
      });
    },
    platformCsrfToken: () => input.config.platformCsrfToken,
    issueBrowserCsrf: () => browserCsrf.issue(),
    verifyBrowserCsrf: (verification) => verification.operationId.length > 0 && browserCsrf.verify(verification.token),
    close: () => agent.destroy(),
  };
  return Object.freeze(provider);
}

type RuntimeGlobal = typeof globalThis & { [key: symbol]: NodeSiteRuntimeProvider | undefined };

export function installNodeSiteRuntimeProviderFromEnv(env: NodeJS.ProcessEnv = process.env): Readonly<NodeSiteRuntimeProvider> {
  const root = globalThis as RuntimeGlobal;
  if (root[REGISTRY] !== undefined) return root[REGISTRY];
  const runtime = loadNodeSiteRuntime(env);
  const provider = createNodeSiteRuntimeProvider(runtime);
  root[REGISTRY] = provider;
  return provider;
}

export function registeredNodeSiteRuntimeProvider(): Readonly<NodeSiteRuntimeProvider> | undefined {
  return (globalThis as RuntimeGlobal)[REGISTRY];
}
