// 中断恢复：snapshot 是在途 run 的权威判据；90s 兜底由状态机 TIMEOUT 事件收口。

import type { SessionSnapshot } from "@/contract/http"

// 兜底：重连后长时间无终态（后端已停/网络长断）则放弃续传，避免永久卡在 streaming。
export const REATTACH_TIMEOUT_MS = 90_000

export type ReattachPlan = {
  runId: string
  // 该 run 存在 pending 暂停点：直接落 awaiting-hitl（审批卡即刻可操作，不设兜底超时）。
  awaiting: boolean
}

// snapshot 有在途 run 时给出重连计划（不发新 POST，只按水位续订 SSE 并锚定该 runId）。
export function reattachPlanFromSnapshot(snapshot: SessionSnapshot): ReattachPlan | null {
  const activeRun = snapshot.active_run
  if (activeRun === undefined) {
    return null
  }
  const awaiting = snapshot.pending_pauses.some(
    (pause) => pause.run_id === activeRun.run_id && pause.status === "pending",
  )
  return { runId: activeRun.run_id, awaiting }
}
