import { validateSiteRuntimeReadiness } from "../../../../runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await validateSiteRuntimeReadiness();
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "5" },
    });
  }
}
