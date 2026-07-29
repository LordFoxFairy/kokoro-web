import type { NextRequest } from "next/server"

import { authRouteAllowed, handlers } from "@/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(request: NextRequest): Promise<Response> | Response {
  return authRouteAllowed(request) ? handlers.GET(request) : new Response(null, { status: 403 })
}

export function POST(request: NextRequest): Promise<Response> | Response {
  return authRouteAllowed(request) ? handlers.POST(request) : new Response(null, { status: 403 })
}
