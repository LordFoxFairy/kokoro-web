import { adminCommerceClient } from "@/lib/control-plane/commerce-client";
import { commerceDetailQuery, commerceResourceRef } from "@/lib/control-plane/commerce-http";
import { controlError, controlJson } from "@/lib/control-plane/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: Readonly<{
  params: Promise<Readonly<{ revisionRef: string }>>;
}>): Promise<Response> {
  try {
    const query = commerceDetailQuery(request);
    const { revisionRef } = await context.params;
    return controlJson(await adminCommerceClient.getRedemptionProgram(query.siteId,
      commerceResourceRef(revisionRef)));
  } catch (error) { return controlError(error); }
}
