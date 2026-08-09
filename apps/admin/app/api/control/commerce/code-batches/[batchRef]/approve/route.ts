import { codeBatchSiteInputSchema } from "@/lib/commerce-contract";
import { adminCommerceClient } from "@/lib/control-plane/commerce-client";
import { commerceBatchRef, noCommerceQuery } from "@/lib/control-plane/commerce-http";
import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: Readonly<{
  params: Promise<Readonly<{ batchRef: string }>>;
}>): Promise<Response> {
  try {
    noCommerceQuery(request);
    const { siteId } = codeBatchSiteInputSchema.parse(await boundedJson(request));
    const { batchRef } = await context.params;
    return controlJson(await adminCommerceClient.approveCodeBatch(siteId, commerceBatchRef(batchRef)));
  } catch (error) { return controlError(error); }
}
