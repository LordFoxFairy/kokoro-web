import { auth } from "@/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(): Promise<Response> {
  const session = await auth() as { authState?: string } | null
  return Response.json(
    { state: session?.authState === "authenticated" ? "authenticated" : "anonymous" },
    { headers: { "cache-control": "no-store" } },
  )
}
