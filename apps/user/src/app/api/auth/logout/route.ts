import { authRouteAllowed, signOut } from "@/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request): Promise<Response> {
  if (!authRouteAllowed(request)) return Response.json({ error: "forbidden_origin" }, { status: 403 })
  await signOut({ redirect: false })
  return Response.json({ status: "logged_out" }, { headers: { "cache-control": "no-store" } })
}
