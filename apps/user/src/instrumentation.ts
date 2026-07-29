export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return
  const [{ installNodeSiteRuntimeProviderFromEnv }, {
    initializeSessionV3ProductionComposition,
    registerSessionV3Provider,
  }] = await Promise.all([
    import("@kokoro/site-runtime-node"),
    import("./lib/server/session-v3"),
  ])
  registerSessionV3Provider(installNodeSiteRuntimeProviderFromEnv())
  initializeSessionV3ProductionComposition()
}
