import { z } from "zod";

import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { publishSiteRelease } from "@/lib/control-plane/client";

export const runtime = "nodejs";

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const signatureBase64 = z.string().min(88).max(684).refine((value) => {
  const decoded = Buffer.from(value, "base64");
  return decoded.byteLength >= 64 && decoded.byteLength <= 512 && decoded.toString("base64") === value;
});
const localePolicy = z.object({
  defaultLocale: z.string().min(1).max(64),
  allowedLocales: z.array(z.string().min(1).max(64)).min(1).max(32).refine(unique),
}).strict().superRefine((value, context) => {
  if (!value.allowedLocales.includes(value.defaultLocale)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["allowedLocales"], message: "default_locale_not_allowed" });
  }
});
const certification = z.object({
  signingKeyRef: z.string().min(3).max(256),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  signatureBase64,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "certification_expiry_invalid" });
  }
});
const publishSiteReleaseInput = z.object({
  siteId: z.string().min(3).max(128), releaseRef: z.string().min(3).max(256),
  webArtifactDigest: digest, releaseManifestDigest: digest, certificationDigest: digest,
  launchProfileRef: z.string().min(3).max(256), siteConfigRevisionRef: z.string().min(3).max(256),
  legalRevisionRef: z.string().min(3).max(256), featurePolicyRevision: z.string().min(3).max(256),
  modelOptionCatalogRef: z.string().min(3).max(256), agentCatalogRef: z.string().min(3).max(256),
  identityIssuerLabel: z.string().min(1).max(64),
  identityAuthStrengthPolicyRevision: z.string().min(3).max(256),
  enabledSurfaceIds: z.array(z.string().min(1).max(128)).min(1).max(64).refine(unique),
  localePolicy, certification,
}).strict();

export async function POST(request: Request) {
  try {
    return controlJson(await publishSiteRelease(publishSiteReleaseInput.parse(await boundedJson(request))), { status: 201 });
  } catch (error) { return controlError(error); }
}
