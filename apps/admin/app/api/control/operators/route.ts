import { NextRequest } from "next/server";
import { controlError, controlJson } from "@/lib/control-plane/http";
import { listOperators } from "@/lib/control-plane/client";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { try { return controlJson(await listOperators(request.nextUrl.searchParams.get("pageToken") ?? undefined)); } catch (error) { return controlError(error); } }
