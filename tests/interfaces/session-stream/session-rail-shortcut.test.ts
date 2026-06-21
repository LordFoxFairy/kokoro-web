import { describe, expect, it } from "vitest"

import { isNewChatShortcut } from "@/interfaces/session-stream/components/session-rail-shortcut"

const chord = (over: Partial<Parameters<typeof isNewChatShortcut>[0]>) => ({
  key: "o",
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...over,
})

describe("isNewChatShortcut", () => {
  it("matches ⌘⇧O (mac) and Ctrl⇧O (win/linux)", () => {
    expect(isNewChatShortcut(chord({ metaKey: true, shiftKey: true }))).toBe(true)
    expect(isNewChatShortcut(chord({ ctrlKey: true, shiftKey: true }))).toBe(true)
  })

  it("matches a capitalised O (shift uppercases the key)", () => {
    expect(
      isNewChatShortcut(chord({ key: "O", metaKey: true, shiftKey: true })),
    ).toBe(true)
  })

  it("rejects the chord without shift, without modifier, or wrong key", () => {
    expect(isNewChatShortcut(chord({ metaKey: true }))).toBe(false)
    expect(isNewChatShortcut(chord({ shiftKey: true }))).toBe(false)
    expect(
      isNewChatShortcut(chord({ key: "k", metaKey: true, shiftKey: true })),
    ).toBe(false)
  })
})
