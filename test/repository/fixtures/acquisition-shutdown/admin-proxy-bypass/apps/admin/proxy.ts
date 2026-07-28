import { NextResponse } from "next/server";

export function proxy(request: Request): Response {
  return NextResponse.rewrite(new URL("/api/action", request.url));
}
