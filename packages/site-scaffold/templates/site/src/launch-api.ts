import "server-only";

import { createSiteLaunchApi, type LaunchOperation } from "@kokoro/site-bff";

import { readOpaqueAuthSession } from "./auth";
import { siteBff } from "./bff";
import { siteAuthSecret, siteLegalDocuments } from "./runtime-config";

let launchApi: ReturnType<typeof createSiteLaunchApi> | undefined;
const allowedOperations = __ALLOWED_LAUNCH_OPERATIONS_JSON__ as const satisfies readonly LaunchOperation[];

export function siteLaunchApi() {
  if (launchApi !== undefined) return launchApi;
  launchApi = createSiteLaunchApi({
    runtime: siteBff(),
    stateSecret: siteAuthSecret(),
    readAuthSession: () => readOpaqueAuthSession(),
    allowedOperations,
    legalDocuments: siteLegalDocuments(),
  });
  return launchApi;
}
