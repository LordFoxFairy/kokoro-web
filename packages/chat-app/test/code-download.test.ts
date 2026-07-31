import { describe, expect, it, vi } from "vitest"

import { downloadCodeText } from "../src/code-download.js"

describe("code download", () => {
  it("downloads only the already-rendered text through a temporary Blob URL", () => {
    const click = vi.fn()
    const anchor = { href: "", download: "", click }
    const createObjectURL = vi.fn(() => "blob:temporary-code")
    const revokeObjectURL = vi.fn()

    downloadCodeText({
      text: "const safe = true",
      language: "typescript",
      document: { createElement: vi.fn(() => anchor) },
      url: { createObjectURL, revokeObjectURL },
    })

    expect(createObjectURL).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe("text/plain;charset=utf-8")
    expect(anchor).toEqual(expect.objectContaining({
      href: "blob:temporary-code",
      download: "code-snippet.ts",
    }))
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:temporary-code")
  })
})
