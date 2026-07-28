import "server-only";

import { z } from "zod";

const MAX_ACTION_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_GATEWAY_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_OPENAPI_RESPONSE_BYTES = 2 * 1024 * 1024;
const OPENAPI_GATEWAY_TIMEOUT_MS = 5_000;
const OPENAPI_MODULE_IDS = new Set(["site", "user", "model", "credit", "hub"]);
const OPENAPI_UPSTREAM_ERROR_CODES = new Map<number, ReadonlySet<string>>([
  [401, new Set(["operator.auth"])],
  [403, new Set(["operator.auth"])],
  [502, new Set(["gateway.openapi_upstream", "gateway.openapi_invalid", "gateway.openapi_too_large"])],
  [504, new Set(["gateway.openapi_timeout"])],
]);

const ACQUISITION_DISABLED = {
  error: { code: "ACQUISITION_CHANNEL_DISABLED", message: "Acquisition channel is disabled" },
} as const;
const TRUST_UNAVAILABLE = {
  error: { code: "auth.boundary_unavailable", message: "Admin trust boundary is unavailable" },
} as const;

const actionSchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  kind: z.string(),
  requiredPermission: z.string().optional(),
  route: z.string().nullable().optional(),
});
const resourceSchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  route: z.string(),
  siteScopeField: z.enum(["siteId", "id"]).nullable(),
  actions: z.array(actionSchema).optional(),
});
const manifestSchema = z.object({ resources: z.array(resourceSchema).optional() });
const manifestsEnvelopeSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      online: z.boolean(),
      manifest: manifestSchema.nullable().optional(),
    }),
  ),
  requestId: z.string().optional(),
});

const creditStatsSchema = z.object({
  accountsTotal: z.number(),
  accountsActive: z.number(),
  balanceSumMicros: z.string(),
  heldSumMicros: z.string(),
  grantedTotalMicros: z.string(),
  spentTotalMicros: z.string(),
});
const billingOverviewEnvelopeSchema = z.object({
  data: z.object({ credit: creditStatsSchema.nullable() }),
  requestId: z.string().optional(),
});

const identitySchema = z.object({
  id: z.string(),
  email: z.string().nullish(),
  displayName: z.string().nullish(),
  status: z.string().nullish(),
});
const creditAccountSchema = z.object({
  id: z.string(),
  status: z.string().nullish(),
  balanceMicros: z.string().nullish(),
  heldMicros: z.string().nullish(),
});
const user360EnvelopeSchema = z.object({
  data: z.object({
    identity: identitySchema.nullable(),
    creditAccount: creditAccountSchema.nullable(),
  }),
  requestId: z.string().optional(),
});

const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
  requestId: z.string().optional(),
});
const actionBoundarySchema = z.object({ moduleId: z.unknown().optional(), route: z.unknown().optional() }).passthrough();
const openApiDocumentSchema = z.object({ openapi: z.string().min(1) }).passthrough();

type BoundedRead =
  | { kind: "ok"; text: string }
  | { kind: "too_large" }
  | { kind: "read_error" };

function disabled(): Response {
  return Response.json(ACQUISITION_DISABLED, { status: 404 });
}

function trustUnavailable(): Response {
  return Response.json(TRUST_UNAVAILABLE, { status: 503 });
}

function badGateway(): Response {
  return Response.json(
    { error: { code: "gateway.bad_response", message: "Admin gateway returned an invalid response" } },
    { status: 502 },
  );
}

function responseTooLarge(): Response {
  return Response.json(
    { error: { code: "gateway.response_too_large", message: "Admin gateway response exceeds the size limit" } },
    { status: 502 },
  );
}

function requestTooLarge(): Response {
  return Response.json(
    { error: { code: "request.too_large", message: "Admin action request exceeds the size limit" } },
    { status: 413 },
  );
}

function invalidModule(): Response {
  return Response.json(
    { error: { code: "request.invalid", message: "Invalid OpenAPI module" } },
    { status: 400 },
  );
}

function gatewayTimeout(): Response {
  return Response.json(
    { error: { code: "gateway.timeout", message: "Admin gateway request timed out" } },
    { status: 504 },
  );
}

function isPaymentModule(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "payment";
}

function isPaymentRoute(value: unknown): boolean {
  return typeof value === "string" && /(?:^|\/)payments?(?:\/|$)/iu.test(value.trim());
}

function declaredLengthExceeds(headers: Headers, limit: number): boolean {
  const raw = headers.get("content-length")?.trim();
  if (raw === undefined || !/^\d+$/u.test(raw)) return false;
  const length = Number(raw);
  return Number.isSafeInteger(length) && length > limit;
}

async function cancelBody(source: Request | Response): Promise<void> {
  try {
    await source.body?.cancel();
  } catch {
    // Cancellation is a resource hint; the stable boundary response remains authoritative.
  }
}

async function readTextBounded(source: Request | Response, limit: number): Promise<BoundedRead> {
  if (declaredLengthExceeds(source.headers, limit)) {
    await cancelBody(source);
    return { kind: "too_large" };
  }
  if (source.body === null) return { kind: "ok", text: "" };

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      chunks.push(result.value);
    }
  } catch {
    return { kind: "read_error" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", text: new TextDecoder().decode(bytes) };
}

function trustedGatewayHeaders(request: Request, hasBody: boolean): Headers | null {
  const configuredSecret = process.env.KOKORO_ADMIN_PROXY_SECRET?.trim() ?? "";
  const suppliedSecret = request.headers.get("x-kokoro-proxy-secret")?.trim() ?? "";
  const operator = request.headers.get("x-kokoro-operator")?.trim() ?? "";
  if (configuredSecret.length === 0 || suppliedSecret !== configuredSecret || operator.length === 0) return null;

  const headers = new Headers();
  for (const name of ["accept", "x-request-id"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("x-kokoro-operator", operator);
  headers.set("x-kokoro-proxy-secret", configuredSecret);
  if (hasBody) headers.set("content-type", "application/json");
  return headers;
}

function gatewayTarget(request: Request, path: string): URL {
  const baseUrl = process.env.KOKORO_GATEWAY_URL?.trim() || "http://127.0.0.1:4290";
  const target = new URL(path, baseUrl);
  target.search = new URL(request.url).search;
  return target;
}

function fixedGatewayTarget(path: string): URL {
  const baseUrl = process.env.KOKORO_GATEWAY_URL?.trim() || "http://127.0.0.1:4290";
  return new URL(path, baseUrl);
}

async function fetchGateway(request: Request, path: string, headers: Headers, body?: string): Promise<Response | null> {
  try {
    return await fetch(gatewayTarget(request, path), {
      method: body === undefined ? "GET" : "POST",
      headers,
      ...(body === undefined ? {} : { body }),
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
    });
  } catch {
    return null;
  }
}

function unavailable(): Response {
  return Response.json(
    { error: { code: "gateway.unavailable", message: "Admin gateway is unavailable" } },
    { status: 502 },
  );
}

async function readUpstreamJsonWithLimit(
  upstream: Response,
  limit: number,
): Promise<{ kind: "ok"; raw: unknown } | Exclude<BoundedRead, { kind: "ok" }>> {
  const read = await readTextBounded(upstream, limit);
  if (read.kind !== "ok") return read;
  try {
    return { kind: "ok", raw: JSON.parse(read.text) as unknown };
  } catch {
    return { kind: "read_error" };
  }
}

async function readUpstreamJson(upstream: Response): Promise<{ kind: "ok"; raw: unknown } | Exclude<BoundedRead, { kind: "ok" }>> {
  return readUpstreamJsonWithLimit(upstream, MAX_GATEWAY_RESPONSE_BYTES);
}

function normalizedError(upstream: Response, raw: unknown): Response {
  const parsed = errorEnvelopeSchema.safeParse(raw);
  const body = parsed.success
    ? parsed.data
    : { error: { code: "gateway.error", message: "Admin gateway request failed" } };
  const headers = new Headers({ "content-type": "application/json" });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter !== null) headers.set("retry-after", retryAfter);
  return new Response(JSON.stringify(body), { status: upstream.status, headers });
}

function normalizedOpenApiError(upstream: Response, raw: unknown): Response {
  const parsed = errorEnvelopeSchema.safeParse(raw);
  const allowedCodes = OPENAPI_UPSTREAM_ERROR_CODES.get(upstream.status);
  if (parsed.success && allowedCodes?.has(parsed.data.error.code) === true) {
    return normalizedError(upstream, parsed.data);
  }
  return Response.json(
    { error: { code: "gateway.error", message: "Admin gateway request failed" } },
    { status: 502 },
  );
}

async function parsedUpstream(upstream: Response): Promise<{ kind: "ok"; raw: unknown } | { kind: "response"; response: Response }> {
  const read = await readUpstreamJson(upstream);
  if (read.kind === "too_large") return { kind: "response", response: responseTooLarge() };
  if (read.kind === "read_error") return { kind: "response", response: badGateway() };
  if (!upstream.ok) return { kind: "response", response: normalizedError(upstream, read.raw) };
  return read;
}

async function relayBoundedJson(upstream: Response): Promise<Response> {
  const parsed = await parsedUpstream(upstream);
  if (parsed.kind === "response") return parsed.response;
  return Response.json(parsed.raw, { status: upstream.status });
}

export async function getFilteredManifests(request: Request): Promise<Response> {
  const headers = trustedGatewayHeaders(request, false);
  if (headers === null) return trustUnavailable();
  const upstream = await fetchGateway(request, "/api/manifests", headers);
  if (upstream === null) return unavailable();
  const read = await parsedUpstream(upstream);
  if (read.kind === "response") return read.response;
  const parsed = manifestsEnvelopeSchema.safeParse(read.raw);
  if (!parsed.success) return badGateway();
  return Response.json({ ...parsed.data, data: parsed.data.data.filter((module) => !isPaymentModule(module.id)) });
}

export async function getFilteredOpenApi(request: Request, moduleId: string): Promise<Response> {
  const headers = trustedGatewayHeaders(request, false);
  if (headers === null) return trustUnavailable();
  if (isPaymentModule(moduleId)) return disabled();
  if (!OPENAPI_MODULE_IDS.has(moduleId)) return invalidModule();

  const controller = new AbortController();
  let timedOut = false;
  const abortForRequest = (): void => controller.abort(request.signal.reason);
  if (request.signal.aborted) abortForRequest();
  else request.signal.addEventListener("abort", abortForRequest, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Admin gateway request timed out", "TimeoutError"));
  }, OPENAPI_GATEWAY_TIMEOUT_MS);

  try {
    const upstream = await fetch(fixedGatewayTarget(`/api/openapi/${moduleId}`), {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (timedOut) {
      await cancelBody(upstream);
      return gatewayTimeout();
    }

    const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json" && contentType !== "application/openapi+json") {
      await cancelBody(upstream);
      return badGateway();
    }

    const read = await readUpstreamJsonWithLimit(upstream, MAX_OPENAPI_RESPONSE_BYTES);
    if (timedOut) return gatewayTimeout();
    if (read.kind === "too_large") return responseTooLarge();
    if (read.kind === "read_error") return badGateway();
    if (!upstream.ok) return normalizedOpenApiError(upstream, read.raw);

    const document = openApiDocumentSchema.safeParse(read.raw);
    if (!document.success) return badGateway();
    return Response.json(document.data, {
      status: 200,
      headers: { "content-disposition": `inline; filename="${moduleId}-openapi.json"` },
    });
  } catch {
    return timedOut ? gatewayTimeout() : unavailable();
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortForRequest);
  }
}

export async function getCreditBillingOverview(request: Request): Promise<Response> {
  const headers = trustedGatewayHeaders(request, false);
  if (headers === null) return trustUnavailable();
  const upstream = await fetchGateway(request, "/api/billing-overview", headers);
  if (upstream === null) return unavailable();
  const read = await parsedUpstream(upstream);
  if (read.kind === "response") return read.response;
  const parsed = billingOverviewEnvelopeSchema.safeParse(read.raw);
  if (!parsed.success) return badGateway();
  return Response.json(parsed.data);
}

export async function getAccountUser360(request: Request): Promise<Response> {
  const headers = trustedGatewayHeaders(request, false);
  if (headers === null) return trustUnavailable();
  const upstream = await fetchGateway(request, "/api/user360", headers);
  if (upstream === null) return unavailable();
  const read = await parsedUpstream(upstream);
  if (read.kind === "response") return read.response;
  const parsed = user360EnvelopeSchema.safeParse(read.raw);
  if (!parsed.success) return badGateway();
  return Response.json(parsed.data);
}

export async function getFilteredResource(request: Request): Promise<Response> {
  const headers = trustedGatewayHeaders(request, false);
  if (headers === null) return trustUnavailable();
  const url = new URL(request.url);
  if (url.searchParams.getAll("moduleId").some(isPaymentModule) || url.searchParams.getAll("route").some(isPaymentRoute)) {
    return disabled();
  }
  const upstream = await fetchGateway(request, "/api/resource", headers);
  return upstream === null ? unavailable() : relayBoundedJson(upstream);
}

export async function postFilteredAction(request: Request): Promise<Response> {
  const headers = trustedGatewayHeaders(request, true);
  if (headers === null) return trustUnavailable();
  const read = await readTextBounded(request, MAX_ACTION_REQUEST_BYTES);
  if (read.kind === "too_large") return requestTooLarge();
  if (read.kind === "read_error") {
    return Response.json({ error: { code: "request.invalid", message: "Invalid action request" } }, { status: 400 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(read.text) as unknown;
  } catch {
    return Response.json({ error: { code: "request.invalid", message: "Invalid JSON request" } }, { status: 400 });
  }
  const parsed = actionBoundarySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: { code: "request.invalid", message: "Invalid action request" } }, { status: 400 });
  }
  if (isPaymentModule(parsed.data.moduleId) || isPaymentRoute(parsed.data.route)) return disabled();
  const upstream = await fetchGateway(request, "/api/action", headers, read.text);
  return upstream === null ? unavailable() : relayBoundedJson(upstream);
}
