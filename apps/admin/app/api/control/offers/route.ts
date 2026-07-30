import { NextRequest } from "next/server";
import { z } from "zod";
import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { listOffers, publishOffer } from "@/lib/control-plane/client";
import { adminWorkloadConfig } from "@/lib/control-plane/config";
export const runtime = "nodejs";
const output = z.object({ lineId: z.string().min(1).max(128), ordinal: z.number().int().nonnegative(), cardinality: z.number().int().min(1).max(100), kind: z.enum(["subscription_term", "entitlement_grant", "credit_grant"]), targetRef: z.string().min(1).max(256) }).strict();
const plan = z.object({ planRef: z.string().min(1).max(256), planVersionRef: z.string().min(1).max(256), revision: z.number().int().positive(), safeLabel: z.string().min(1).max(160), termAction: z.enum(["none", "new_subscription", "extend_from_max", "reject_if_active"]), termSeconds: z.number().int().positive().optional(), stackingScope: z.string().min(1).max(128) }).strict();
const schema = z.object({ productRef: z.string().min(1).max(256), productVersionRef: z.string().min(1).max(256), productKind: z.enum(["credit_pack", "subscription", "bundle"]), revision: z.number().int().positive(), safeLabel: z.string().min(1).max(160), fulfillmentProgramRef: z.string().min(1).max(256), fulfillmentProgramRevisionRef: z.string().min(1).max(256), fulfillmentProgramRevision: z.number().int().positive(), plan: plan.optional(), outputs: z.array(output).min(1).max(100), legalTermRefs: z.array(z.string().min(1).max(256)).max(16) }).strict();
export async function GET(request: NextRequest) { try { return controlJson(await listOffers((await adminWorkloadConfig()).siteId, request.nextUrl.searchParams.get("pageToken") ?? undefined)); } catch (error) { return controlError(error); } }
export async function POST(request: NextRequest) { try { const input = schema.parse(await boundedJson(request)); return controlJson(await publishOffer({ ...input, siteId: (await adminWorkloadConfig()).siteId }), { status: 201 }); } catch (error) { return controlError(error); } }
