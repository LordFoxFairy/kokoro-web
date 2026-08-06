import { z } from "zod";

import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { publishSiteRelease } from "@/lib/control-plane/client";

export const runtime = "nodejs";

const uint64 = z.string().refine((value) => /^[1-9][0-9]{0,19}$/u.test(value) &&
  BigInt(value) <= 18_446_744_073_709_551_615n);
const publishSiteReleaseInput = z.object({
  siteId: z.string().min(3).max(128), candidateRef: z.string().min(3).max(256),
  candidateVersion: uint64, candidateAuthorizationEpoch: uint64,
  candidateDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  reason: z.string().min(3).max(512),
}).strict();

export async function POST(request: Request) {
  try {
    return controlJson(await publishSiteRelease(publishSiteReleaseInput.parse(await boundedJson(request))), { status: 201 });
  } catch (error) { return controlError(error); }
}
