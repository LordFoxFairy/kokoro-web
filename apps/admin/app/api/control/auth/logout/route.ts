import { NextResponse } from "next/server";

import { clearAuthoritySession } from "@/lib/control-plane/authority-session";
import { signOutAdminSession } from "@/lib/control-plane/identity-client";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try { await signOutAdminSession(); } catch { /* Local credential is still destroyed fail-closed. */ }
  await clearAuthoritySession();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303,
    headers: { "cache-control": "no-store", pragma: "no-cache" } });
}
