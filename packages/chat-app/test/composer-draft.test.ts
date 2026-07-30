import { describe, expect, it } from "vitest"

import {
  createComposerDraftStore,
  type ComposerDraftStorage,
} from "../src/composer-draft.js"

function storage(): ComposerDraftStorage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
    removeItem(key) { values.delete(key) },
  }
}

describe("session-scoped composer draft persistence", () => {
  it("keeps independent drafts for two conversations in one browser runtime", () => {
    const browserStorage = storage()
    const store = createComposerDraftStore({
      storage: browserStorage,
      scope: "browser-scope-12345678",
      now: () => 10_000,
    })

    store.save({
      schemaVersion: 1,
      sessionId: "session-first-12345678",
      revision: "revision-first-12345678",
      text: "first draft",
      modelOptionRevisionRef: "model-option-quality-12345678",
      effort: "high",
      updatedAt: 10_000,
    })
    store.save({
      schemaVersion: 1,
      sessionId: "session-second-12345678",
      revision: "revision-second-12345678",
      text: "second draft",
      updatedAt: 10_000,
    })

    expect(store.load("session-first-12345678")?.text).toBe("first draft")
    expect(store.load("session-first-12345678")).toMatchObject({
      modelOptionRevisionRef: "model-option-quality-12345678",
      effort: "high",
    })
    expect(store.load("session-second-12345678")?.text).toBe("second draft")
  })

  it("clears only the exact submitted revision and preserves later input", () => {
    const store = createComposerDraftStore({
      storage: storage(),
      scope: "browser-scope-12345678",
      now: () => 10_000,
    })
    store.save({
      schemaVersion: 1,
      sessionId: "session-12345678",
      revision: "revision-newer-12345678",
      text: "typed while the submit response was pending",
      updatedAt: 10_000,
    })

    store.clear("session-12345678", "revision-submitted-12345678")
    expect(store.load("session-12345678")?.text).toBe("typed while the submit response was pending")

    store.clear("session-12345678", "revision-newer-12345678")
    expect(store.load("session-12345678")).toBeNull()
  })

  it("prunes drafts from a rotated identity scope", () => {
    const browserStorage = storage()
    const oldStore = createComposerDraftStore({
      storage: browserStorage,
      scope: "browser-scope-old-1234",
      now: () => 10_000,
    })
    oldStore.save({
      schemaVersion: 1,
      sessionId: "session-12345678",
      revision: "revision-old-12345678",
      text: "must not cross an account switch",
      updatedAt: 10_000,
    })

    createComposerDraftStore({
      storage: browserStorage,
      scope: "browser-scope-new-1234",
      pruneOtherScopes: true,
      now: () => 10_000,
    })

    expect(oldStore.load("session-12345678")).toBeNull()
  })
})
