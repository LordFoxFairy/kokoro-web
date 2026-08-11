import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import * as assetClient from "@kokoro/asset-client"

vi.mock("../src/session-asset-uploader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/session-asset-uploader.js")>()
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined, key: () => null, length: 0 } satisfies Storage
  return {
    ...actual,
    useSessionAssetUploader(input: Parameters<typeof actual.useSessionAssetUploader>[0]) {
      return actual.createSessionAssetUploader({ enabled: input.enabled, csrfToken: "csrf", contextPolicy: "standard", recoveryScope: "scope", localStorage: storage, sessionStorage: storage })
    },
  }
})

const { ChatProduct } = await import("../src/chat-product.js")

function renderProduct(attachmentsEnabled: boolean) {
  return renderToStaticMarkup(<ChatProduct attachmentsEnabled={attachmentsEnabled} bootstrap={null} brandName="Kokoro" browserRuntimeScope="scope" />)
}

describe("ChatProduct attachment runtime composition", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("passes disabled through the uploader hook without creating an Asset uploader", () => {
    const factory = vi.spyOn(assetClient, "createAssetUploader")
    renderProduct(false)
    expect(factory).not.toHaveBeenCalled()
  })

  it("keeps the default enabled path wired to the Asset uploader factory", () => {
    const factory = vi.spyOn(assetClient, "createAssetUploader")
    renderProduct(true)
    expect(factory).toHaveBeenCalledTimes(1)
  })
})
