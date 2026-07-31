import type { AssetRecoveryRecord } from "@kokoro/asset-client"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { DEFAULT_CHAT_COPY } from "../src/chat-copy.js"
import {
  createEphemeralAssetRecoveryStore,
  sessionBrowserPersistence,
} from "../src/session-context-policy.js"
import { createSessionAssetUploader } from "../src/session-asset-uploader.js"
import { TemporaryChatStatus } from "../src/temporary-chat.js"

function recoveryRecord(): AssetRecoveryRecord {
  return {
    schemaVersion: 1,
    fingerprint: "a".repeat(64) + ":4:text/plain",
    filename: "note.txt",
    mediaType: "text/plain",
    size: 4,
    checksumSha256: "a".repeat(64),
    purpose: "chat_attachment",
    ownerCreate: { commandId: "command-12345678", idempotencyKey: "idempotency-12345678" },
    clientUploadId: "browser-upload-12345678",
    initiateIdempotencyKey: "initiate-12345678",
    partIdempotencyKeys: {},
    dataCompleteIdempotencyKey: "complete-data-12345678",
    dataCompleteExpectedVersion: null,
    ownerComplete: { commandId: "command-complete-12345678", idempotencyKey: "idempotency-complete-12345678" },
    owner: null,
  }
}

describe("Temporary Chat browser policy", () => {
  it("disables every cross-session browser recovery channel", () => {
    expect(sessionBrowserPersistence("temporary")).toEqual({
      commandRecovery: false,
      composerDraft: false,
      uploadRecovery: false,
      ordinaryHistory: false,
    })
    expect(sessionBrowserPersistence("standard")).toEqual({
      commandRecovery: true,
      composerDraft: true,
      uploadRecovery: true,
      ordinaryHistory: true,
    })
  })

  it("keeps upload recovery memory-only for the lifetime of one mounted temporary Session", async () => {
    const store = createEphemeralAssetRecoveryStore()
    const record = recoveryRecord()

    await store.put(record)
    expect(await store.get(record.fingerprint)).toEqual(record)
    await store.delete(record.fingerprint)
    expect(await store.get(record.fingerprint)).toBeNull()
  })

  it("composes temporary upload recovery without touching browser storage", () => {
    const unavailableStorage = {
      get length(): number { throw new Error("browser storage must not be consulted") },
    } as Storage

    const uploader = createSessionAssetUploader({
      csrfToken: "csrf-token-12345678",
      contextPolicy: "temporary",
      recoveryScope: "site-a:project-a",
      localStorage: unavailableStorage,
      sessionStorage: unavailableStorage,
    })

    expect(uploader).not.toBeNull()
    uploader?.dispose()
  })

  it("falls back to session storage when durable upload recovery is unavailable", () => {
    let sessionStorageObserved = false
    const unavailableLocalStorage = {
      get length(): number { throw new Error("local storage unavailable") },
    } as Storage
    const availableSessionStorage = {
      get length(): number {
        sessionStorageObserved = true
        return 0
      },
      key: () => null,
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
    } as Storage

    const uploader = createSessionAssetUploader({
      csrfToken: "csrf-token-12345678",
      contextPolicy: "standard",
      recoveryScope: "site-a:project-a",
      localStorage: unavailableLocalStorage,
      sessionStorage: availableSessionStorage,
    })

    expect(sessionStorageObserved).toBe(true)
    expect(uploader).not.toBeNull()
    uploader?.dispose()
  })

  it("states the bounded privacy behavior without claiming that the conversation leaves no trace", () => {
    const html = renderToStaticMarkup(<TemporaryChatStatus copy={DEFAULT_CHAT_COPY} />)

    expect(html).toContain("Temporary chat")
    expect(html).toContain("ordinary chat history")
    expect(html).toContain("retention, safety, and legal-hold rules still apply")
    expect(html).not.toMatch(/no trace|not stored|deleted immediately/iu)
  })
})
