export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { installNodeSiteRuntimeProviderFromEnv } = await import("@kokoro/site-runtime-node");
  installNodeSiteRuntimeProviderFromEnv();
  const { validateSiteRuntimeConfiguration } = await import("./runtime-config");
  validateSiteRuntimeConfiguration();
}
