import { NextRequest } from "next/server";
import { controlError, controlJson } from "@/lib/control-plane/http";
import { listPendingApprovals } from "@/lib/control-plane/client";
import { adminWorkloadConfig } from "@/lib/control-plane/config";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { try { const p = request.nextUrl.searchParams; return controlJson(await listPendingApprovals((await adminWorkloadConfig()).siteId, p.get("pageToken") ?? undefined)); } catch (error) { return controlError(error); } }
