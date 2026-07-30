import { describe, expect, it } from "vitest"

import { hasSubmittableComposerContent } from "../src/composer-content.js"

describe("composer submit admission", () => {
  it("enables attachment-only submit only after an attachment is ready", () => {
    expect(hasSubmittableComposerContent("", [])).toBe(false)
    expect(hasSubmittableComposerContent("  ", [{ status: "uploading", attachment: null }])).toBe(false)
    expect(hasSubmittableComposerContent("", [{ status: "failed", attachment: null }])).toBe(false)
    expect(hasSubmittableComposerContent("", [{ status: "ready", attachment: {} }])).toBe(true)
    expect(hasSubmittableComposerContent("hello", [])).toBe(true)
  })
})
