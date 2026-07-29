import "server-only";

import { createSiteLaunchApi } from "@kokoro/site-bff";
import { parseSiteLegalDocuments } from "@kokoro/site-bff/site-legal-documents";

import { readOpaqueAuthSession } from "./auth";
import { siteBff } from "./bff";

let launchApi: ReturnType<typeof createSiteLaunchApi> | undefined;

export function siteLaunchApi() {
  if (launchApi !== undefined) return launchApi;
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  const legalDocuments = parseSiteLegalDocuments(process.env.KOKORO_SITE_REGISTRATION_LEGAL_DOCUMENTS);
  launchApi = createSiteLaunchApi({
    runtime: siteBff(),
    stateSecret: secret,
    readAuthSession: () => readOpaqueAuthSession(),
    legalDocuments,
  });
  return launchApi;
}
