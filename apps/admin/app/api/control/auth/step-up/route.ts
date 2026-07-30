import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { beginAdminStepUp } from "@/lib/control-plane/identity-client";
import { setStepUpTransaction } from "@/lib/control-plane/authority-session";

export const runtime = "nodejs";
const operation = z.enum(["commerce.offer.publish", "commerce.code-batch.issue", "commerce.code-batch.approve",
  "commerce.redemption-program.publish", "commerce.code-batch.activate", "commerce.code-batch.suspend",
  "commerce.code-batch.revoke"]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const selected = operation.parse(request.nextUrl.searchParams.get("operation"));
    const resources = request.nextUrl.searchParams.getAll("resource").map((value) => z.string().min(1).max(256).parse(value));
    if (resources.length < 1 || resources.length > 100) throw new Error("invalid_resources");
    const returnPath = z.string().startsWith("/").max(256).parse(request.nextUrl.searchParams.get("return") ?? "/");
    if (returnPath.startsWith("//")) throw new Error("invalid_return");
    const result = await beginAdminStepUp({ operation: selected, resourceRefs: resources });
    await setStepUpTransaction({ transactionRef: result.transactionRef, operation: selected,
      resourceRefs: resources, returnPath, expiresAt: result.expiresAt });
    return NextResponse.redirect(result.authorizationUri, { headers: { "cache-control": "no-store", pragma: "no-cache" } });
  } catch {
    return NextResponse.json({ error: { code: "admin_identity.step_up_unavailable" } }, { status: 400,
      headers: { "cache-control": "no-store", pragma: "no-cache" } });
  }
}
