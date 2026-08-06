import { NextRequest, NextResponse } from "next/server";
import { AUTHORITY_COOKIE } from "./lib/control-plane/session-constants";

export default function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const isHealthRoute =
    pathname === "/api/health/live" ||
    pathname === "/api/health/ready";
  if (isHealthRoute) return NextResponse.next();

  const isAuthPage = pathname.startsWith("/login");
  const isAuthRoute = pathname.startsWith("/api/control/auth/");
  const hasSession = req.cookies.has(AUTHORITY_COOKIE);

  if (!hasSession) {
    if (isAuthPage || isAuthRoute) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "auth.unauthenticated", message: "未登录" } }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (isAuthPage || pathname === "/api/control/auth/login" || pathname === "/api/control/auth/callback") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
