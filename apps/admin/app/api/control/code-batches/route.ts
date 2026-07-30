import { NextRequest } from "next/server";
import { z } from "zod";
import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { issueCodeBatch, listCodeBatches } from "@/lib/control-plane/client";
export const runtime = "nodejs";
const siteId = z.string().min(1).max(128);
const schema = z.object({ siteId, batchRef: z.string().uuid(), redemptionProgramRevisionRef: z.string().min(1).max(256), count: z.number().int().min(1).max(1000), startsAt: z.string().datetime({ offset: true }).optional(), endsAt: z.string().datetime({ offset: true }).optional() }).strict();
export async function GET(request: NextRequest) { try { return controlJson(await listCodeBatches(siteId.parse(request.nextUrl.searchParams.get("siteId")), request.nextUrl.searchParams.get("pageToken") ?? undefined)); } catch (error) { return controlError(error); } }
export async function POST(request: NextRequest) { try { return controlJson(await issueCodeBatch(schema.parse(await boundedJson(request))), { status: 201, headers: { "content-disposition": "attachment; filename=kokoro-code-batch.json" } }); } catch (error) { return controlError(error); } }
