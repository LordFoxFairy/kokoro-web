import { postFilteredAction } from "@/lib/admin-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return postFilteredAction(request);
}
