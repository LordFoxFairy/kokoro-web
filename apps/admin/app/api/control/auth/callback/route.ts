import { NextRequest, NextResponse } from "next/server";

import { exchangeAdminLogin } from "@/lib/control-plane/identity-client";
import { openPlatformDelivery, setAuthoritySession, takeLoginTransaction } from "@/lib/control-plane/authority-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const transaction = await takeLoginTransaction();
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  if (transaction === null || state !== transaction.transactionRef || code.length < 1 || code.length > 2048) {
    return NextResponse.redirect(new URL("/login?error=invalid_callback", request.url), { headers: noStore() });
  }
  try {
    const exchanged = await exchangeAdminLogin({ transactionRef: transaction.transactionRef,
      authorizationCode: code, recoveryHandle: transaction.recoveryHandle });
    const authority = await openPlatformDelivery({ envelope: exchanged.envelope,
      transactionRef: transaction.transactionRef, exchangeRequestDigest: exchanged.exchangeRequestDigest,
      operatorSessionRef: exchanged.operatorSessionRef });
    await setAuthoritySession(authority);
    return NextResponse.redirect(new URL("/", request.url), { headers: noStore() });
  } catch {
    return NextResponse.redirect(new URL("/login?error=login_failed", request.url), { headers: noStore() });
  }
}

function noStore(): HeadersInit { return { "cache-control": "no-store", pragma: "no-cache" }; }
