import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { authConfig, userRefreshSession } from "@/lib/server/auth"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_ID: "site-a",
}

function oversizedChunkedResponse(chunkBytes: number, chunkCount: number): {
  response: Response
  wasCancelled: () => boolean
} {
  let emitted = 0
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= chunkCount) {
        controller.close()
        return
      }
      emitted += 1
      controller.enqueue(new Uint8Array(chunkBytes))
    },
    cancel() {
      cancelled = true
    },
  })
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
    wasCancelled: () => cancelled,
  }
}

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of Object.keys(ENV)) delete process.env[key]
})

describe("parsed upstream response memory bounds", () => {
  it("cancels a chunked auth response once it exceeds the 256 KiB cap", async () => {
    const oversized = oversizedChunkedResponse(128 * 1024, 100)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(oversized.response))

    const result = await userRefreshSession(authConfig()!, "refresh-token")

    expect(result).toBeNull()
    expect(oversized.wasCancelled()).toBe(true)
  })
})
