import { getAccountUser360 } from "@/lib/admin-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return getAccountUser360(request);
}
