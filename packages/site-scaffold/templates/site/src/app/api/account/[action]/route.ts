import { siteLaunchApi } from "../../../../launch-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "dashboard" | "prepare" | "execute" | "recover";

async function dispatch(request: Request, context: { params: Promise<{ action: string }> }): Promise<Response> {
  const { action } = await context.params;
  if (action !== "dashboard" && action !== "prepare" && action !== "execute" && action !== "recover") {
    return new Response(null, { status: 404 });
  }
  return siteLaunchApi().handle(request, action as Action);
}

export const GET = dispatch;
export const POST = dispatch;
