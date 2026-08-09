import { adminCommerceClient } from "@/lib/control-plane/commerce-client";
import { commerceListQuery, noCommerceQuery } from "@/lib/control-plane/commerce-http";
import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { publishRedemptionProgramInputSchema } from "@/lib/commerce-contract";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try { return controlJson(await adminCommerceClient.listRedemptionPrograms(commerceListQuery(request))); }
  catch (error) { return controlError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    noCommerceQuery(request);
    const input = publishRedemptionProgramInputSchema.parse(await boundedJson(request));
    return controlJson(await adminCommerceClient.publishRedemptionProgram(input), { status: 201 });
  } catch (error) { return controlError(error); }
}
