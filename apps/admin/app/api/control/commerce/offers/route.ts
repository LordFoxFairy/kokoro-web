import { adminCommerceClient } from "@/lib/control-plane/commerce-client";
import { commerceListQuery, noCommerceQuery } from "@/lib/control-plane/commerce-http";
import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { publishOfferInputSchema } from "@/lib/commerce-contract";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try { return controlJson(await adminCommerceClient.listOffers(commerceListQuery(request))); }
  catch (error) { return controlError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    noCommerceQuery(request);
    const input = publishOfferInputSchema.parse(await boundedJson(request));
    return controlJson(await adminCommerceClient.publishOffer(input), { status: 201 });
  } catch (error) { return controlError(error); }
}
