import { rawGatewayFetch } from "@/lib/raw-gateway";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return rawGatewayFetch(request);
}

export async function POST(request: Request): Promise<Response> {
  return rawGatewayFetch(request);
}
