import { describe, expect, it } from "vitest"

import { loadSiteBffDeployment } from "../src/index.js"

describe("Site BFF deployment configuration", () => {
  it("loads the staging runtime environment", () => {
    const deployment = loadSiteBffDeployment({
      KOKORO_SITE_RUNTIME_ENVIRONMENT: "staging",
      KOKORO_SITE_PUBLIC_ORIGIN: "https://site.example",
      KOKORO_SITE_PROJECT_BINDING_REF: "binding-12345678",
      KOKORO_SITE_DEPLOYMENT_REF: "deployment-12345678",
      KOKORO_SITE_RELEASE_REF: "release-12345678",
      KOKORO_WEB_ARTIFACT_DIGEST: "a".repeat(64),
      KOKORO_PLATFORM_WORKLOAD_CREDENTIAL: "w".repeat(64),
      KOKORO_SESSION_CONTRACT_REVISION: "session-browser-v3",
      KOKORO_SITE_REGION: "us-east-1",
      KOKORO_PRODUCT_AUDIENCE: "kokoro.site.example",
    })

    expect(deployment.binding.runtimeEnvironment).toBe("staging")
  })
})
