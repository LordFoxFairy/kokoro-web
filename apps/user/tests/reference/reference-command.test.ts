import { createHash } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

import { createCommandIdentity } from "@kokoro/chat-app"

afterEach(() => vi.restoreAllMocks())

describe("command identity", () => {
  it("digests canonical UTF-16-key-ordered JSON and omits undefined object fields", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001")
    const identity = await createCommandIdentity({
      operation: "submit_message",
      targets: { session_id: "session-1" },
      effect: { z: 1, optional: undefined, a: { b: true } },
    })
    const canonical = "{\"effect\":{\"a\":{\"b\":true},\"z\":1},\"operation\":\"submit_message\",\"targets\":{\"session_id\":\"session-1\"}}"

    expect(identity).toEqual({
      command_id: "00000000000040008000000000000001",
      idempotency_key: "web:00000000000040008000000000000001",
      digest_algorithm: "SHA256_CANONICAL_JSON_V2",
      request_digest: createHash("sha256").update(canonical).digest("hex"),
    })
  })
})
