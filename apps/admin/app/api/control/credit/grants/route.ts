import { adminCreditReader } from "@/lib/control-plane/credit-client";
import { parseCreditGrantListQuery } from "@/lib/control-plane/credit-route-query";
import { controlError, controlJson } from "@/lib/control-plane/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return controlJson(await adminCreditReader.listCreditGrants(parseCreditGrantListQuery(request))); }
  catch (error) { return controlError(error); }
}
