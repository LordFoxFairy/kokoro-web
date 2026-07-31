import type { AssetRecoveryRecord } from "@kokoro/asset-client"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { DEFAULT_CHAT_COPY } from "../src/chat-copy.js"
import {
  createEphemeralAssetRecoveryStore,
  sessionBrowserPersistence,
} from "../src/session-context-policy.js"
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

  it("states the bounded privacy behavior without claiming that the conversation leaves no trace", () => {
    const html = renderToStaticMarkup(<TemporaryChatStatus copy={DEFAULT_CHAT_COPY} />)

    expect(html).toContain("Temporary chat")
    expect(html).toContain("ordinary chat history")
    expect(html).toContain("retention, safety, and legal-hold rules still apply")
    expect(html).not.toMatch(/no trace|not stored|deleted immediately/iu)
  })
})
