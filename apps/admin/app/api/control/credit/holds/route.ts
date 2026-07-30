import { adminCreditReader } from "@/lib/control-plane/credit-client";
import { parseCreditHoldListQuery } from "@/lib/control-plane/credit-route-query";
import { controlError, controlJson } from "@/lib/control-plane/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return controlJson(await adminCreditReader.listCreditHolds(parseCreditHoldListQuery(request))); }
  catch (error) { return controlError(error); }
}
