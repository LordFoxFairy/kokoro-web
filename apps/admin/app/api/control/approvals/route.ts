import { NextRequest } from "next/server";
import { z } from "zod";
import { controlError, controlJson } from "@/lib/control-plane/http";
import { listPendingApprovals } from "@/lib/control-plane/client";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { try { const p = request.nextUrl.searchParams;
  const siteId = z.string().min(1).max(128).optional().parse(p.get("siteId") ?? undefined);
  return controlJson(await listPendingApprovals(siteId, p.get("pageToken") ?? undefined)); } catch (error) { return controlError(error); } }
