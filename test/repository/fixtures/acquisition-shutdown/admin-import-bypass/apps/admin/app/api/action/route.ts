import { postFilteredAction } from "@/lib/admin-gateway";
import { rawGatewayFetch } from "@/lib/raw-gateway";

export async function POST(request: Request): Promise<Response> {
  if (request.headers.has("x-bypass")) return rawGatewayFetch(request);
  return postFilteredAction(request);
}
