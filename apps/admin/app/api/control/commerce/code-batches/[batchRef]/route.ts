import { adminCommerceClient } from "@/lib/control-plane/commerce-client";
import { commerceBatchRef, commerceDetailQuery } from "@/lib/control-plane/commerce-http";
import { controlError, controlJson } from "@/lib/control-plane/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: Readonly<{
  params: Promise<Readonly<{ batchRef: string }>>;
}>): Promise<Response> {
  try {
    const query = commerceDetailQuery(request);
    const { batchRef } = await context.params;
    return controlJson(await adminCommerceClient.getCodeBatch(query.siteId, commerceBatchRef(batchRef)));
  } catch (error) { return controlError(error); }
}
