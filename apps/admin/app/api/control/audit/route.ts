import { NextRequest } from "next/server";
import { z } from "zod";

import { controlError, controlJson } from "@/lib/control-plane/http";
import { getAuditWithinScope } from "@/lib/control-plane/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest | Request) {
  try {
    const query = new URL(request.url).searchParams;
    const siteId = z.string().min(1).max(128).optional().parse(query.get("siteId") ?? undefined);
    const pageToken = z.string().min(1).max(256).optional().parse(query.get("pageToken") ?? undefined);
    return controlJson(await getAuditWithinScope(siteId, pageToken));
  } catch (error) { return controlError(error); }
}
