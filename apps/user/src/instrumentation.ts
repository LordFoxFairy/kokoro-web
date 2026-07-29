export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { initializeSessionV3ProductionComposition } = await import("./lib/server/session-v3")
  // The separately deployed provider installs through registerSessionV3Provider in this static
  // composition boundary. Until its deployment package is present, first use fails closed with
  // the generated INTERNAL_UNAVAILABLE envelope; legacy JWT transport is never selected.
  initializeSessionV3ProductionComposition()
}
