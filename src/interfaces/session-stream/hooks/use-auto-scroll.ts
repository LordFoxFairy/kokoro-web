import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject, UIEvent } from "react"

import type { SessionMessage } from "@/application/session-stream-reducer"

// 贴底阈值：距底不足这个像素就视为“跟随”，新增内容才继续自动滚动。
// 留一点余量，避免 1px 误差或子像素让跟随态在贴底时反复抖动。
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
): AutoScroll {
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  // 用户是否贴近底部：贴底时跟随新内容滚动，上滑后不再被新内容拽回。
  // 同步镜像到 ref，供自动滚动 effect 读取最新值而不必把它列入依赖。
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

  // 仅在用户贴底时跟随新内容滚动；上滑阅读历史时不抢夺视图。
  // 贴底态从 ref 读取最新值，故只依赖会触发新内容的 messages/streaming。
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToLatest()
    }
  }, [messages, isStreaming, scrollToLatest])

  const handleThreadScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      setNearBottom(isThreadNearBottom(event.currentTarget))
    },
    [setNearBottom],
  )

  return { threadEndRef, isNearBottom, scrollToLatest, handleThreadScroll }
}
