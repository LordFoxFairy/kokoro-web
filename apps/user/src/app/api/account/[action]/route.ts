import { userLaunchApi } from "@/lib/server/launch-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function dispatch(request: Request, context: { params: Promise<{ action: string }> }): Promise<Response> {
  const { action } = await context.params
  if (action !== "dashboard" && action !== "prepare" && action !== "execute" && action !== "recover") {
    return new Response(null, { status: 404 })
  }
  return userLaunchApi().handle(request, action)
}

export const GET = dispatch
export const POST = dispatch
