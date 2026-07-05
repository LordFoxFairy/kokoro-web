// snapshot → 线程状态水合：messages/active_run/pending_pauses 的纯转换，服务端是权威读取模型。

import type { PendingPause, SessionSnapshot } from "@/contract/http"

import type { SessionMessage, SessionStep, SessionStreamState } from "./state"

function toMessage(record: SessionSnapshot["messages"][number]): SessionMessage {
  const streaming =
    record.role === "assistant" &&
    (record.status === "pending" || record.status === "streaming")
  return {
    id: record.message_id,
    role: record.role,
    // 用户消息无 run_id 时以自身 id 充当，与本地 appendUserMessage 同语义。
    runId: record.run_id ?? record.message_id,
    content: record.content,
    // 在途 assistant 占位：续流的首个文本事件按 run 认领续写（见 reducer）。
    ...(streaming ? { hydratedStreaming: true } : {}),
  }
}

// pending pause → awaiting 工具步：刷新后审批卡/问答卡直接可操作。
// 同 run 的全部 pending pause 构成同一帧：pending_tool_ids 由此派生（凑齐才提交判据）。
function toAwaitingSteps(pauses: readonly PendingPause[]): Record<string, SessionStep[]> {
  const stepsByRun: Record<string, SessionStep[]> = {}
  const idsByRun = new Map<string, string[]>()
  for (const pause of pauses) {
    const ids = idsByRun.get(pause.run_id) ?? []
    ids.push(pause.tool_id)
    idsByRun.set(pause.run_id, ids)
  }
  for (const pause of pauses) {
    const steps = stepsByRun[pause.run_id] ?? []
    steps.push({
      kind: "tool",
      // 水合步骤按到达序占位（水位前的历史 seq 不可知）；续流事件 seq 恒大于水位，排序仍稳定。
      seq: steps.length + 1,
      segmentId: pause.segment_id,
      tool: {
        id: pause.tool_id,
        name: pause.tool_name,
        args: pause.args,
        status: "awaiting",
        description: pause.description,
        allowedDecisions: [...pause.allowed_decisions],
        awaitingKind: pause.kind,
        editable: pause.editable,
        pendingToolIds: idsByRun.get(pause.run_id) ?? [],
        ...(pause.risk !== undefined ? { risk: pause.risk } : {}),
        ...(pause.input_schema !== undefined ? { inputSchema: pause.input_schema } : {}),
        // result_review：待审结果预填 result，刷新后审核卡直接可读可裁决。
        ...(pause.result !== undefined ? { result: pause.result } : {}),
      },
    })
    stepsByRun[pause.run_id] = steps
  }
  return stepsByRun
}

export function stateFromSnapshot(snapshot: SessionSnapshot): SessionStreamState {
  const pending = snapshot.pending_pauses.filter((pause) => pause.status === "pending")
  return {
    seenEventIds: new Set(),
    messages: snapshot.messages.map(toMessage),
    todos: [],
    stepsByRun: toAwaitingSteps(pending),
    files: snapshot.files,
    runStatus: "idle",
    activeRunId: snapshot.active_run?.run_id ?? null,
    // 续流从服务端水位之后开始：snapshot 已折叠的事件不再重放进状态。
    lastSeq: snapshot.event_watermark,
    meta: {
      title: snapshot.session.title,
      ownerId: snapshot.session.owner_id,
    },
  }
}
