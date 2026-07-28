import "server-only";

import { z } from "zod";

const ACQUISITION_DISABLED = {
  error: { code: "ACQUISITION_CHANNEL_DISABLED", message: "Acquisition channel is disabled" },
} as const;

const manifestsEnvelopeSchema = z
  .object({
    data: z.array(z.object({ id: z.string() }).passthrough()),
  })
  .passthrough();

const billingOverviewEnvelopeSchema = z
  .object({
    data: z.object({}).passthrough(),
  })
  .passthrough();

const user360EnvelopeSchema = z
  .object({
    data: z.object({}).passthrough(),
  })
  .passthrough();

const actionBoundarySchema = z.object({ moduleId: z.unknown().optional(), route: z.unknown().optional() }).passthrough();

function disabled(): Response {
  return Response.json(ACQUISITION_DISABLED, { status: 404 });
}

function badGateway(): Response {
  return Response.json({ error: { code: "gateway.bad_response", message: "Admin gateway returned an invalid response" } }, { status: 502 });
}

function isPaymentModule(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "payment";
}

function isPaymentRoute(value: unknown): boolean {
  return typeof value === "string" && /(?:^|\/)payments?(?:\/|$)/iu.test(value.trim());
}

function requestHeaders(request: Request, hasBody: boolean): Headers {
  const headers = new Headers();
  for (const name of ["accept", "x-kokoro-operator", "x-kokoro-proxy-secret", "x-request-id"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (hasBody) headers.set("content-type", request.headers.get("content-type") ?? "application/json");
  return headers;
}

function gatewayTarget(request: Request, path: string): URL {
  const baseUrl = process.env.KOKORO_GATEWAY_URL?.trim() || "http://127.0.0.1:4290";
  const target = new URL(path, baseUrl);
  target.search = new URL(request.url).search;
  return target;
}

async function fetchGateway(request: Request, path: string, body?: string): Promise<Response | null> {
  try {
    return await fetch(gatewayTarget(request, path), {
      method: body === undefined ? "GET" : "POST",
      headers: requestHeaders(request, body !== undefined),
      ...(body === undefined ? {} : { body }),
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
    });
  } catch {
    return null;
  }
}

function relay(upstream: Response): Response {
  const headers = new Headers();
  for (const name of ["content-type", "retry-after", "x-request-id"]) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

function unavailable(): Response {
  return Response.json({ error: { code: "gateway.unavailable", message: "Admin gateway is unavailable" } }, { status: 502 });
}

export async function getFilteredManifests(request: Request): Promise<Response> {
  const upstream = await fetchGateway(request, "/api/manifests");
  if (upstream === null) return unavailable();
  if (!upstream.ok) return relay(upstream);
  const parsed = manifestsEnvelopeSchema.safeParse(await upstream.json().catch(() => null));
  if (!parsed.success) return badGateway();
  return Response.json(
    { ...parsed.data, data: parsed.data.data.filter((module) => !isPaymentModule(module.id)) },
    { status: upstream.status },
  );
}

export async function getCreditBillingOverview(request: Request): Promise<Response> {
  const upstream = await fetchGateway(request, "/api/billing-overview");
  if (upstream === null) return unavailable();
  if (!upstream.ok) return relay(upstream);
  const parsed = billingOverviewEnvelopeSchema.safeParse(await upstream.json().catch(() => null));
  if (!parsed.success) return badGateway();
  const data = { ...parsed.data.data };
  delete data.payment;
  return Response.json({ ...parsed.data, data }, { status: upstream.status });
}

export async function getAccountUser360(request: Request): Promise<Response> {
  const upstream = await fetchGateway(request, "/api/user360");
  if (upstream === null) return unavailable();
  if (!upstream.ok) return relay(upstream);
  const parsed = user360EnvelopeSchema.safeParse(await upstream.json().catch(() => null));
  if (!parsed.success) return badGateway();
  const data = { ...parsed.data.data };
  delete data.orders;
  return Response.json({ ...parsed.data, data }, { status: upstream.status });
}

export async function getFilteredResource(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.getAll("moduleId").some(isPaymentModule) || url.searchParams.getAll("route").some(isPaymentRoute)) {
    return disabled();
  }
  const upstream = await fetchGateway(request, "/api/resource");
  return upstream === null ? unavailable() : relay(upstream);
}

export async function postFilteredAction(request: Request): Promise<Response> {
  const body = await request.text();
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return Response.json({ error: { code: "request.invalid", message: "Invalid JSON request" } }, { status: 400 });
  }
  const parsed = actionBoundarySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: { code: "request.invalid", message: "Invalid action request" } }, { status: 400 });
  }
  if (isPaymentModule(parsed.data.moduleId) || isPaymentRoute(parsed.data.route)) return disabled();
  const upstream = await fetchGateway(request, "/api/action", body);
  return upstream === null ? unavailable() : relay(upstream);
}
