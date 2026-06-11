import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject, UIEvent } from "react"

import type { SessionMessage } from "@/application/session-stream/reducer"

// 贴底阈值：距底不足此像素即视为“跟随”；留余量避免子像素让贴底态反复抖动。
const NEAR_BOTTOM_THRESHOLD = 64

function isThreadNearBottom(node: HTMLDivElement): boolean {
  return node.scrollTop >= node.scrollHeight - node.clientHeight - NEAR_BOTTOM_THRESHOLD
}

type AutoScroll = {
  threadEndRef: RefObject<HTMLDivElement | null>
  isNearBottom: boolean
  scrollToLatest: () => void
  handleThreadScroll: (event: UIEvent<HTMLDivElement>) => void
}

export function useAutoScroll(
  messages: SessionMessage[],
  isStreaming: boolean,
  scrollToLatestRef: RefObject<() => void>,
  // 过程块（思考/工具/子智能体）静默生长时 messages 引用不变，单独以此信号驱动跟随。
  activityVersion = 0,
): AutoScroll {
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  // 是否贴底（贴底才跟随新内容）；镜像到 ref 供 effect 读最新值而不必列入依赖。
  const [isNearBottom, setIsNearBottom] = useState(true)
  const isNearBottomRef = useRef(true)

  const setNearBottom = useCallback((near: boolean) => {
    isNearBottomRef.current = near
    setIsNearBottom(near)
  }, [])

  const scrollToLatest = useCallback(() => {
    const node = threadEndRef.current

    if (node && typeof node.scrollIntoView === "function") {
      try {
        node.scrollIntoView({ block: "end" })
      } catch {
        // 无布局环境（如 jsdom）下忽略滚动，不影响状态流转。
      }
    }

    setNearBottom(true)
  }, [setNearBottom])

  // 把最新的 scrollToLatest 回填到共享 ref，供会话引擎在事件期调用，打破环依赖。
  useEffect(() => {
    scrollToLatestRef.current = scrollToLatest
  }, [scrollToLatest, scrollToLatestRef])

  // 仅贴底时跟随；贴底态从 ref 读取，故只依赖触发新内容的 messages/streaming/活动版本。
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToLatest()
    }
  }, [messages, isStreaming, activityVersion, scrollToLatest])

  const handleThreadScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      setNearBottom(isThreadNearBottom(event.currentTarget))
    },
    [setNearBottom],
  )

  return { threadEndRef, isNearBottom, scrollToLatest, handleThreadScroll }
}
