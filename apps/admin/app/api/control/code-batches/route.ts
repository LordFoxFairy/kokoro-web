import { NextRequest } from "next/server";
import { z } from "zod";
import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { issueCodeBatch, listCodeBatches } from "@/lib/control-plane/client";
import { adminWorkloadConfig } from "@/lib/control-plane/config";
export const runtime = "nodejs";
const schema = z.object({ batchRef: z.string().uuid(), redemptionProgramRevisionRef: z.string().min(1).max(256), count: z.number().int().min(1).max(1000), startsAt: z.string().datetime({ offset: true }).optional(), endsAt: z.string().datetime({ offset: true }).optional() }).strict();
export async function GET(request: NextRequest) { try { return controlJson(await listCodeBatches((await adminWorkloadConfig()).siteId, request.nextUrl.searchParams.get("pageToken") ?? undefined)); } catch (error) { return controlError(error); } }
export async function POST(request: NextRequest) { try { const input = schema.parse(await boundedJson(request)); return controlJson(await issueCodeBatch({ ...input, siteId: (await adminWorkloadConfig()).siteId }), { status: 201, headers: { "content-disposition": "attachment; filename=kokoro-code-batch.json" } }); } catch (error) { return controlError(error); } }
