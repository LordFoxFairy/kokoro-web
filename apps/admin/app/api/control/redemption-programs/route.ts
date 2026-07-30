import { NextRequest } from "next/server";
import { z } from "zod";
import { adminWorkloadConfig } from "@/lib/control-plane/config";
import { listRedemptionPrograms, publishRedemptionProgram } from "@/lib/control-plane/client";
import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";

export const runtime = "nodejs";
const schema = z.object({ redemptionProgramRevisionRef: z.string().min(1).max(256),
  programRef: z.string().min(1).max(256), revision: z.number().int().positive(),
  productVersionRef: z.string().min(1).max(256), fulfillmentProgramRevisionRef: z.string().min(1).max(256),
  maxRedemptionsPerAccount: z.number().int().min(1).max(10000) }).strict();

export async function GET(request: NextRequest) { try { return controlJson(await listRedemptionPrograms(
  (await adminWorkloadConfig()).siteId, request.nextUrl.searchParams.get("pageToken") ?? undefined)); }
catch (error) { return controlError(error); } }
export async function POST(request: NextRequest) { try { const input = schema.parse(await boundedJson(request));
  return controlJson(await publishRedemptionProgram({ ...input, siteId: (await adminWorkloadConfig()).siteId }),
    { status: 201 }); } catch (error) { return controlError(error); } }
