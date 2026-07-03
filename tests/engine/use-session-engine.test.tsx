import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { ConversationStore } from "@/core/conversations"
import { createSessionEngine, SERVER_ENGINE_SNAPSHOT } from "@/engine/machine"
import { useSessionEngine } from "@/engine/use-session-engine"

import { createFakeClient, createMemoryStorage } from "./fakes"

describe("useSessionEngine", () => {
  it("engine 为 null（SSR/未装配）时返回 server 快照", () => {
    const { result } = renderHook(() => useSessionEngine(null))
    expect(result.current).toBe(SERVER_ENGINE_SNAPSHOT)
  })

  it("订阅引擎快照：命令下发后视图同步更新", () => {
    const engine = createSessionEngine({
      client: createFakeClient(),
      storage: createMemoryStorage<ConversationStore>(null),
      createId: (prefix) => `${prefix}_1`,
    })
    const { result, unmount } = renderHook(() => useSessionEngine(engine))
    expect(result.current.machine.phase).toBe("idle")
    act(() => {
      engine.submit("hello")
    })
    expect(result.current.machine.phase).toBe("submitting")
    expect(result.current.thread.messages).toHaveLength(1)
    unmount()
    engine.dispose()
  })
})
