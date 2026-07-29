import "server-only";

import { createSiteBffRuntime, loadSiteBffDeployment } from "@kokoro/site-bff";
import { registeredNodeSiteRuntimeProvider } from "@kokoro/site-runtime-node";

let runtime: ReturnType<typeof createSiteBffRuntime> | undefined;

export function siteBff() {
  if (runtime !== undefined) return runtime;
  const provider = registeredNodeSiteRuntimeProvider();
  if (provider === undefined) throw new Error("registered Site runtime provider is unavailable");
  runtime = createSiteBffRuntime({ ...loadSiteBffDeployment(), provider });
  return runtime;
}
