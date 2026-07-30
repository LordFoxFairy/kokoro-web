import { NextRequest, NextResponse } from "next/server";
import { completeAdminStepUp } from "@/lib/control-plane/identity-client";
import { takeStepUpTransaction, updateAuthoritySessionStepUp } from "@/lib/control-plane/authority-session";

export const runtime = "nodejs";
export async function GET(request: NextRequest): Promise<NextResponse> {
  const transaction = await takeStepUpTransaction(); const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  if (transaction === null || state !== transaction.transactionRef || code.length < 1 || code.length > 2048) {
    return NextResponse.redirect(new URL("/?error=invalid_step_up", request.url));
  }
  try { await updateAuthoritySessionStepUp(await completeAdminStepUp({ transactionRef: transaction.transactionRef,
    authorizationCode: code }));
    return NextResponse.redirect(new URL(transaction.returnPath, request.url), { headers: { "cache-control": "no-store" } });
  } catch { return NextResponse.redirect(new URL(`${transaction.returnPath}?error=step_up_failed`, request.url)); }
}
