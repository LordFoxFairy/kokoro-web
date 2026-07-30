import { NextRequest } from "next/server";
import { z } from "zod";

import { controlError, controlJson } from "@/lib/control-plane/http";
import { getAuditWithinScope } from "@/lib/control-plane/client";
import { strictQuery } from "@/lib/control-plane/strict-query";

export const runtime = "nodejs";

export async function GET(request: NextRequest | Request) {
  try {
    const query = strictQuery(request, {
      siteId: z.string().min(1).max(128).optional(),
      pageToken: z.string().min(1).max(256).optional(),
    });
    return controlJson(await getAuditWithinScope(query.siteId, query.pageToken));
  } catch (error) { return controlError(error); }
}
