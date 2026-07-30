import "server-only";

import { createSiteLaunchApi } from "@kokoro/site-bff";

import { readOpaqueAuthSession } from "./auth";
import { siteBff } from "./bff";
import { siteAuthSecret, siteLegalDocuments } from "./runtime-config";

let launchApi: ReturnType<typeof createSiteLaunchApi> | undefined;

export function siteLaunchApi() {
  if (launchApi !== undefined) return launchApi;
  launchApi = createSiteLaunchApi({
    runtime: siteBff(),
    stateSecret: siteAuthSecret(),
    readAuthSession: () => readOpaqueAuthSession(),
    legalDocuments: siteLegalDocuments(),
  });
  return launchApi;
}
