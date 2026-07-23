import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject, UIEvent } from "react"

import type { SessionStreamState } from "@/core/state"

// 贴底阈值：距底不足此像素即视为「跟随」；留余量避免子像素让贴底态反复抖动。
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

// 贴底跟随：thread 状态引用每次事件折叠都会更新——事件到达本身即滚动信号，
// 不再做全量字符扫描（旧 computeActivityVersion 删除）。
export function useAutoScroll(thread: SessionStreamState, isStreaming: boolean): AutoScroll {
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

  // 仅贴底时跟随；贴底态从 ref 读取，故只依赖触发新内容的 thread/streaming。
  useEffect(() => {
    if (isNearBottomRef.current && (thread.messages.length > 0 || isStreaming)) {
      scrollToLatest()
    }
  }, [thread, isStreaming, scrollToLatest])

  const handleThreadScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      setNearBottom(isThreadNearBottom(event.currentTarget))
    },
    [setNearBottom],
  )

  return { threadEndRef, isNearBottom, scrollToLatest, handleThreadScroll }
}
