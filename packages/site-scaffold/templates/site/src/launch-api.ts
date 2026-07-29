import "server-only";

import { createSiteLaunchApi } from "@kokoro/site-bff";

import { readOpaqueAuthSession } from "./auth";
import { siteBff } from "./bff";

let launchApi: ReturnType<typeof createSiteLaunchApi> | undefined;

export function siteLaunchApi() {
  if (launchApi !== undefined) return launchApi;
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  const legalAcceptanceRefs = (process.env.KOKORO_SITE_REGISTRATION_LEGAL_REFS ?? "")
    .split(",").map((value) => value.trim()).filter((value) => value.length > 0 && value.length <= 128).slice(0, 16);
  launchApi = createSiteLaunchApi({
    runtime: siteBff(),
    stateSecret: secret,
    readAuthSession: () => readOpaqueAuthSession(),
    registrationLegalAcceptanceRefs: legalAcceptanceRefs,
  });
  return launchApi;
}
