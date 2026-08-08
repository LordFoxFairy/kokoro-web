import { NextRequest } from "next/server";
import { z } from "zod";

import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { listSites, registerSite } from "@/lib/control-plane/client";
import { strictQuery } from "@/lib/control-plane/strict-query";

export const runtime = "nodejs";

const registerSiteInput = z.object({
  siteId: z.string().min(3).max(128),
  siteKey: z.string().regex(/^[a-z][a-z0-9-]{2,62}$/u),
  projectBindingRef: z.string().min(3).max(256),
  repositoryRef: z.string().min(3).max(512),
  providerNamespace: z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/u),
  providerProjectRef: z.string().min(3).max(512),
  workloadIdentityRef: z.string().startsWith("spiffe://").max(512),
}).strict();

export async function GET(request: NextRequest | Request) {
  try {
    const query = strictQuery(request, { pageToken: z.string().min(1).max(1024).optional() });
    return controlJson(await listSites(query.pageToken));
  } catch (error) { return controlError(error); }
}

export async function POST(request: NextRequest | Request) {
  try {
    return controlJson(await registerSite(registerSiteInput.parse(await boundedJson(request))), { status: 201 });
  } catch (error) { return controlError(error); }
}
