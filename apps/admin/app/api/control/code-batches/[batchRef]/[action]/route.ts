import { NextRequest } from "next/server";
import { z } from "zod";
import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { codeBatchAction } from "@/lib/control-plane/client";
export const runtime = "nodejs";
const body = z.object({ siteId: z.string().min(1).max(128), reason: z.string().min(1).max(1000) }).strict();
const action = z.enum(["approve", "activate", "suspend", "revoke"]);
export async function POST(request: NextRequest, context: { params: Promise<{ batchRef: string; action: string }> }) { try { const params = await context.params; const input = body.parse(await boundedJson(request)); return controlJson(await codeBatchAction(action.parse(params.action), { ...input, batchRef: z.string().uuid().parse(params.batchRef) })); } catch (error) { return controlError(error); } }
