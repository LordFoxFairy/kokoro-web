import { getFilteredOpenApi } from "@/lib/admin-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ moduleId: string }> },
): Promise<Response> {
  const { moduleId } = await context.params;
  return getFilteredOpenApi(request, moduleId);
}
