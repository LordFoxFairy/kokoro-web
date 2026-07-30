import { z } from "zod";

import { controlError, controlJson } from "@/lib/control-plane/http";
import { getSite } from "@/lib/control-plane/client";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    return controlJson(await getSite(z.string().min(1).max(128).parse((await context.params).siteId)));
  } catch (error) { return controlError(error); }
}
