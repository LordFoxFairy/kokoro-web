import "server-only";

import type { NextRequest } from "next/server";

export type AuthRouteHandler = (request: NextRequest) => Promise<Response>;
export type AuthRouteHandlers = Readonly<{ GET: AuthRouteHandler; POST: AuthRouteHandler }>;

function canonicalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function rejected(): Response {
  return new Response(null, { status: 400 });
}

function uniformPublicError(response: Response, origin: string): Response {
  const location = response.headers.get("location");
  if (location === null) return response;
  try {
    const target = new URL(location, origin);
    if (target.origin !== origin || target.pathname !== "/auth/verify" || !target.searchParams.has("error")) {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set("location", "/auth/verify?error=Verification");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

export function createTrustedAuthHandlers(
  handlers: AuthRouteHandlers,
  configuredUrl: string,
): AuthRouteHandlers {
  const origin = canonicalOrigin(configuredUrl);
  async function GET(request: NextRequest): Promise<Response> {
    if (origin === null || request.nextUrl.origin !== origin) return rejected();
    return uniformPublicError(await handlers.GET(request), origin);
  }
  async function POST(request: NextRequest): Promise<Response> {
    if (origin === null || request.nextUrl.origin !== origin || request.headers.get("origin") !== origin) {
      return rejected();
    }
    return uniformPublicError(await handlers.POST(request), origin);
  }
  return Object.freeze({ GET, POST });
}
