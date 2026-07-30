import { z } from "zod";

import { controlError, controlJson } from "@/lib/control-plane/http";
import { strictQuery } from "@/lib/control-plane/strict-query";
import { adminUserReader } from "@/lib/control-plane/user-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const siteId = z.string().min(1).max(128);
const userRef = z.string().min(1).max(128);

export async function GET(request: Request, context: { params: Promise<{ userRef: string }> }): Promise<Response> {
  try {
    const query = strictQuery(request, { siteId });
    return controlJson(await adminUserReader.getUserWithinSite(query.siteId,
      userRef.parse((await context.params).userRef)));
  } catch (reason) { return controlError(reason); }
}
