import { adminCommerceClient } from "@/lib/control-plane/commerce-client";
import { commerceListQuery, noCommerceQuery } from "@/lib/control-plane/commerce-http";
import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { issueCodeBatchInputSchema } from "@/lib/commerce-contract";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try { return controlJson(await adminCommerceClient.listCodeBatches(commerceListQuery(request))); }
  catch (error) { return controlError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    noCommerceQuery(request);
    const input = issueCodeBatchInputSchema.parse(await boundedJson(request));
    return controlJson(await adminCommerceClient.issueCodeBatch(input), { status: 201 });
  } catch (error) { return controlError(error); }
}
