"use client"

import { useEffect, useState } from "react"
import { MessageProcessor } from "@a2ui/web_core/v0_9"
import type { SurfaceModel } from "@a2ui/web_core/v0_9"
import type { ReactComponentImplementation } from "@a2ui/react/v0_9"
import { kokoroChatCatalog } from "./catalog"
import { startA2uiSession, type A2uiSessionHandle } from "@/application/a2ui-session"

// 起一个 run 并把 A2UI op 流折进 processor，surface 变化时触发重渲染。
export function useA2uiSurface(input: { text: string; sessionId: string }) {
  const [surface, setSurface] = useState<SurfaceModel<ReactComponentImplementation> | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!input.text || !input.sessionId) return

    const processor = new MessageProcessor<ReactComponentImplementation>([kokoroChatCatalog])
    let handle: A2uiSessionHandle = { close: () => {} }
    let disposed = false

    const sync = () => {
      const s = processor.model.getSurface(input.sessionId)
      if (s) setSurface(s)
      setTick((t) => t + 1)
    }
    const sub = processor.onSurfaceCreated(() => sync())

    void startA2uiSession({
      processor,
      input: input.text,
      sessionId: input.sessionId,
      onOp: sync,
    })
      .then((h) => {
        if (disposed) h.close()
        else handle = h
      })
      .catch(() => {})

    return () => {
      disposed = true
      sub.unsubscribe()
      handle.close()
      processor.model.dispose?.()
      // deps 变更时清掉上一个 surface，避免新 session 短暂闪现旧会话内容。
      setSurface(null)
    }
  }, [input.text, input.sessionId])

  return { surface, tick }
}
