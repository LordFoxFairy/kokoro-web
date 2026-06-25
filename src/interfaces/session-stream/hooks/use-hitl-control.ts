import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useRef,
} from "react"

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
// 拒绝默认理由：web 暂无理由输入框；agent reject 的 message 即工具结果/驳回原因，给确定性兜底文案。
const REJECT_MESSAGE = "用户拒绝了该工具调用"

export function useHitlControl({
  activeId,
  isStreaming,
  nowMs,
  persistedStore,
  replyHandleRef,
  setLiveStore,
  store,
}: UseHitlControlArgs) {
  // 同帧多工具决策暂存：runId → (toolId → approve/reject)。凑齐全部 awaiting 才发一条 resume
  // （agent 按 tool_id 一一对齐，缺/多即 fail-loud）；POST 失败保留暂存供重试，不在 render 读写。
  const stagedRef = useRef<Map<string, Map<string, "approve" | "reject">>>(new Map())

  const cancelActiveRun = useCallback(async () => {
    if (!store || !activeId || !isStreaming) {
      return
    }
    const rid = findActiveRunId(activeThreadOf(store))
    if (!rid) {
      return
    }
    await sendRunControl({ sessionId: activeId, runId: rid, body: { kind: "run.cancel" } })
    // run 被放弃：清掉该 run 任何未提交的暂存决策，免得在 stagedRef 里长期滞留。
    stagedRef.current.delete(rid)
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
    async (runId: string, toolId: string, decision: "approve" | "reject") => {
      if (!activeId) {
        return
      }
      const current = store ?? persistedStore
      if (!current) {
        return
      }
      // 该 run 此刻全部待批工具（同帧多工具同属一次暂停）：单工具时立即凑齐→即时提交。
      const steps = activeThreadOf(current).stepsByRun[runId] ?? []
      const awaitingIds = steps.flatMap((step) =>
        step.kind === "tool" && step.tool.status === "awaiting" ? [step.tool.id] : [],
      )
      let staged = stagedRef.current.get(runId)
      if (!staged) {
        staged = new Map()
        stagedRef.current.set(runId, staged)
      }
      staged.set(toolId, decision)
      if (!awaitingIds.every((id) => staged.has(id))) {
        // 仍有同帧工具未决：靠工具行自身的 decided 态给反馈，等齐后统一提交。
        return
      }
      const decisions = awaitingIds.map((id) =>
        staged.get(id) === "reject"
          ? { type: "reject" as const, tool_id: id, message: REJECT_MESSAGE }
          : { type: "approve" as const, tool_id: id },
      )
      await sendRunControl({
        sessionId: activeId,
        runId,
        body: { kind: "run.resume", decisions },
      })
      // 仅 POST 成功后本地收口：被拒工具就地置 rejected（防 reject 回流把它翻成绿勾 done）；
      // 批准的工具不动、待 agent 恢复后正常运行。失败则保留暂存，按钮层恢复可重试。
      const rejectedIds = awaitingIds.filter((id) => staged.get(id) === "reject")
      if (rejectedIds.length > 0) {
        replyHandleRef.current?.markToolRejected?.(runId, rejectedIds)
      }
      stagedRef.current.delete(runId)
    },
    [activeId, persistedStore, replyHandleRef, store],
  )

  return { cancelActiveRun, sendToolDecision }
}
