import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react"

import {
  activeThreadOf,
  withActiveThread,
  type ConversationStore,
} from "@/application/conversation-store"
import {
  findActiveRunId,
  markRunCancelled,
} from "@/application/session-stream/reducer"
import {
  sendRunControl,
  type LiveSessionHandle,
} from "@/application/session-stream/transport"

type UseHitlControlArgs = {
  activeId: string | null
  isStreaming: boolean
  nowMs: () => number
  persistedStore: ConversationStore | null
  replyHandleRef: MutableRefObject<LiveSessionHandle | null>
  setLiveStore: Dispatch<SetStateAction<ConversationStore | null>>
  store: ConversationStore | null
}

// 把 HITL control 相关副作用（approve/reject/cancel + 本地成功态收口）从大而全的 useConversation
// 中抽走，降低该 hook 的职责密度。web 只负责 UI 侧即时反馈，真正的决定仍由 session/agent 落盘执行。
export function useHitlControl({
  activeId,
  isStreaming,
  nowMs,
  persistedStore,
  replyHandleRef,
  setLiveStore,
  store,
}: UseHitlControlArgs) {
  const cancelActiveRun = useCallback(async () => {
    if (!store || !activeId || !isStreaming) {
      return
    }
    const rid = findActiveRunId(activeThreadOf(store))
    if (!rid) {
      return
    }
    await sendRunControl({ sessionId: activeId, runId: rid, decision: "cancel" })
    // 只有 control POST 成功后才本地收口；失败时保持 awaiting，用户可重试，绝不自作主张显示“运行已取消”。
    setLiveStore((prev) => {
      const current = prev ?? persistedStore
      if (!current) {
        return prev
      }
      return withActiveThread(
        current,
        markRunCancelled(activeThreadOf(current), rid),
        nowMs(),
      )
    })
  }, [activeId, isStreaming, nowMs, persistedStore, setLiveStore, store])

  const sendToolDecision = useCallback(
    async (runId: string, decision: "approve" | "reject") => {
      if (!activeId) {
        return
      }
      await sendRunControl({ sessionId: activeId, runId, decision })
      // reject 仅在 control POST 成功后才做本地即时反馈；失败时保持 awaiting，按钮层可恢复重试。
      if (decision === "reject") {
        replyHandleRef.current?.markToolRejected?.(runId)
      }
    },
    [activeId, replyHandleRef],
  )

  return { cancelActiveRun, sendToolDecision }
}
