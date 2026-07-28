import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { trustedAdminHeaders } from "./lib/admin-trust-boundary";

// Proxy 边界只用无 DB 的 authConfig（JWT 验签，不查业务数据库）。
const { auth } = NextAuth(authConfig);

const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/auth/verify");

  if (!req.auth) {
    if (isAuthPage) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "auth.unauthenticated", message: "未登录" } }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (isAuthPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  // 已登录：BFF 向网关注入身份 + 内部密钥（网关 proxy 模式消费）。
  if (pathname.startsWith("/api/")) {
    const headers = trustedAdminHeaders(
      req.headers,
      req.auth.user?.email,
      process.env.KOKORO_ADMIN_PROXY_SECRET,
    );
    if (headers === null) {
      return NextResponse.json(
        { error: { code: "auth.boundary_unavailable", message: "Admin trust boundary is unavailable" } },
        { status: 503 },
      );
    }
    return NextResponse.next({ request: { headers } });
  }

  return NextResponse.next();
});

export default proxy;

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
