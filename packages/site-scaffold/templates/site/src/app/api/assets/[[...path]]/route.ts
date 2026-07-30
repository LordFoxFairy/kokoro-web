import { createSiteAssetApi } from "@kokoro/site-bff";

import { readOpaqueAuthSession } from "../../../../auth";
import { siteBff } from "../../../../bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dispatch(request: Request, context: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const { path = [] } = await context.params;
  return createSiteAssetApi({
    runtime: siteBff(),
    readAuthSession: readOpaqueAuthSession,
  }).handle(request, path);
}

export const GET = dispatch;
export const POST = dispatch;
