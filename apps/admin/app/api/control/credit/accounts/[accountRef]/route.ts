import { adminCreditReader } from "@/lib/control-plane/credit-client";
import { parseCreditAccountDetailQuery } from "@/lib/control-plane/credit-route-query";
import { controlError, controlJson } from "@/lib/control-plane/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: Readonly<{ params: Promise<{ accountRef: string }> }>) {
  try {
    const input = parseCreditAccountDetailQuery(request, (await context.params).accountRef);
    return controlJson(await adminCreditReader.getCreditAccount(input.siteId, input.accountRef));
  } catch (error) { return controlError(error); }
}
