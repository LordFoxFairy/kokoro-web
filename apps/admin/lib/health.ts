import "server-only";

import { adminControlPlaneReadiness } from "@/lib/control-plane/readiness";

type ReadinessCheck = () => Promise<unknown>;

export function adminLivenessResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export async function adminReadinessResponse(
  check: ReadinessCheck = adminControlPlaneReadiness,
): Promise<Response> {
  try {
    await check();
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "retry-after": "5",
        },
      },
    );
  }
}
