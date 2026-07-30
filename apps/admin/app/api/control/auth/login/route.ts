import { NextResponse } from "next/server";

import { beginAdminLogin } from "@/lib/control-plane/identity-client";
import { setLoginTransaction } from "@/lib/control-plane/authority-session";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const login = await beginAdminLogin();
    await setLoginTransaction({ transactionRef: login.transactionRef,
      recoveryHandle: login.recoveryHandle, expiresAt: login.recoveryExpiresAt });
    return NextResponse.redirect(login.authorizationUri, { headers: noStore() });
  } catch {
    return NextResponse.json({ error: { code: "admin_identity.unavailable" } }, { status: 503, headers: noStore() });
  }
}

function noStore(): HeadersInit { return { "cache-control": "no-store", pragma: "no-cache" }; }
