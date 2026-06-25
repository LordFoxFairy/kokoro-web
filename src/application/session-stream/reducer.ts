import type { SessionStreamEvent } from "@/domain/session-stream-event"

import {
  appendRunStep,
  resolveStaleTools,
  updateRunStep,
} from "./state-mutations"
import type { SessionMessage, SessionStreamState } from "./types"

// 公开 API 聚合点：types / state-mutations / thread-projection 经此 re-export，
// 既有 importer 维持从 reducer 取符号，拆分对外不可见。
export type {
  SessionMessage,
  SessionStep,
  SessionStreamState,
  SessionSubagent,
  SessionToolCall,
  ThreadItem,
} from "./types"
export {
  appendUserMessage,
  createSessionStreamState,
  findActiveRunId,
  findAwaitingRunId,
  markRunCancelled,
  markToolRejected,
  resolveStaleTools,
} from "./state-mutations"
export type { Segment } from "./thread-projection"
export {
  buildThreadItems,
  computeActivityVersion,
  groupSegments,
} from "./thread-projection"

function applyMessageEvent(
  state: SessionStreamState,
  event: Extract<
    SessionStreamEvent,
    { kind: "message-delta" | "message-completed" }
  >,
): SessionStreamState {
  const index = state.messages.findIndex(
    (message) => message.id === event.segmentId,
  )

  if (event.kind === "message-delta") {
    if (index >= 0) {
      const existing = state.messages[index]
      // role/runId 在 segmentId 首个增量时确定一次：后续增量只追加正文。
      state.messages[index] = {
        ...(existing as SessionMessage),
        content: `${existing?.content ?? ""}${event.delta}`,
      }
      return state
    }
    state.messages.push({
      id: event.segmentId,
      role: event.role,
      content: event.delta,
      runId: event.runId,
    })
    // 文本步骤进入有序列表：标记「这一段文本在此 seq 出现」，渲染时据此与过程交错。
    return appendRunStep(state, event.runId, {
      kind: "text",
      seq: event.seq,
      segmentId: event.segmentId,
    })
  }

  // completed 必须覆盖累计增量，避免 replay 后残留半句内容。
  if (index >= 0) {
    state.messages[index] = {
      id: event.segmentId,
      role: event.role,
      content: event.content,
      runId: event.runId,
    }
    return state
  }
  state.messages.push({
    id: event.segmentId,
    role: event.role,
    content: event.content,
    runId: event.runId,
  })
  return appendRunStep(state, event.runId, {
    kind: "text",
    seq: event.seq,
    segmentId: event.segmentId,
  })
}

function applyThinkingDelta(
  state: SessionStreamState,
  event: Extract<SessionStreamEvent, { kind: "thinking-delta" }>,
): SessionStreamState {
  const steps = state.stepsByRun[event.runId] ?? []
  // 同一段 thinking 续写：找该 segmentId 的既有 thinking step 追加，否则新建一个有序步骤。
  const existingIndex = steps.findIndex(
    (step) => step.kind === "thinking" && step.segmentId === event.segmentId,
  )
  if (existingIndex >= 0) {
    const existing = steps[existingIndex]
    if (existing?.kind === "thinking") {
      return updateRunStep(
        state,
        event.runId,
        (step) => step === existing,
        (step) =>
          step.kind === "thinking"
            ? { ...step, text: `${step.text}${event.delta}` }
            : step,
      )
    }
    return state
  }
  return appendRunStep(state, event.runId, {
    kind: "thinking",
    seq: event.seq,
    segmentId: event.segmentId,
    text: event.delta,
  })
}

function applyToolInvoked(
  state: SessionStreamState,
  event: Extract<SessionStreamEvent, { kind: "tool-invoked" }>,
): SessionStreamState {
  return appendRunStep(state, event.runId, {
    kind: "tool",
    seq: event.seq,
    segmentId: event.segmentId,
    tool: {
      id: event.toolId,
      name: event.name,
      args: event.args,
      status: "running",
    },
  })
}

function applyToolAwaitingApproval(
  state: SessionStreamState,
  event: Extract<SessionStreamEvent, { kind: "tool-awaiting-approval" }>,
): SessionStreamState {
  const steps = state.stepsByRun[event.runId] ?? []
  const hasInvoked = steps.some(
    (step) => step.kind === "tool" && step.tool.id === event.toolId,
  )
  if (hasInvoked) {
    // 配对：把同一 tool step 翻 awaiting（UI 显批准/拒绝）。
    return updateRunStep(
      state,
      event.runId,
      (step) => step.kind === "tool" && step.tool.id === event.toolId,
      (step) =>
        step.kind === "tool"
          ? { ...step, tool: { ...step.tool, status: "awaiting" } }
          : step,
    )
  }
  // 无配对的 invoked（乱序/部分 replay）：仍补建 awaiting 步，防止审批 UI 丢失。
  return appendRunStep(state, event.runId, {
    kind: "tool",
    seq: event.seq,
    segmentId: event.segmentId,
    tool: {
      id: event.toolId,
      name: event.name,
      args: event.args,
      status: "awaiting",
    },
  })
}

function applyToolReturned(
  state: SessionStreamState,
  event: Extract<SessionStreamEvent, { kind: "tool-returned" }>,
): SessionStreamState {
  const steps = state.stepsByRun[event.runId] ?? []
  const hasInvoked = steps.some(
    (step) => step.kind === "tool" && step.tool.id === event.toolId,
  )
  // rejected（HITL 拒绝，含超时回退）→ rejected 态（replay 安全，区别于 done 态）；
  // is_error=true → 失败态：status=error，errorText 携带原因（UI 显红、可展开查看）。
  const returnedStatus = event.rejected
    ? "rejected"
    : event.isError
      ? "error"
      : "done"
  if (hasInvoked) {
    // 配对：把同一 tool step 由 running 就地翻 done/error，保持原位置（不重排）。
    return updateRunStep(
      state,
      event.runId,
      (step) => step.kind === "tool" && step.tool.id === event.toolId,
      (step) =>
        step.kind === "tool"
          ? {
              ...step,
              tool: {
                ...step.tool,
                result: event.result,
                // 已置 rejected 的工具：其回流（is_error=false 的拒绝文案）不得将 rejected 降级为 done。
                status: step.tool.status === "rejected" ? "rejected" : returnedStatus,
                ...(event.isError ? { errorText: event.result } : {}),
                ...(event.rejectReason !== undefined ? { rejectReason: event.rejectReason } : {}),
                ...(event.responded !== undefined ? { responded: event.responded } : {}),
              },
            }
          : step,
    )
  }
  // 无配对的 invoked（如部分 replay）：仍记录已完成的结果，不丢事件。
  return appendRunStep(state, event.runId, {
    kind: "tool",
    seq: event.seq,
    segmentId: event.segmentId,
    tool: {
      id: event.toolId,
      name: event.name,
      args: {},
      result: event.result,
      status: returnedStatus,
      ...(event.isError ? { errorText: event.result } : {}),
      ...(event.rejectReason !== undefined ? { rejectReason: event.rejectReason } : {}),
      ...(event.responded !== undefined ? { responded: event.responded } : {}),
    },
  })
}

function applySubagentStarted(
  state: SessionStreamState,
  event: Extract<SessionStreamEvent, { kind: "subagent-started" }>,
): SessionStreamState {
  return appendRunStep(state, event.runId, {
    kind: "subagent",
    seq: event.seq,
    segmentId: event.segmentId,
    subagent: {
      id: event.subagentId,
      name: event.name,
      description: event.description,
      subagentType: event.subagentType,
      source: event.source,
      status: "running",
    },
  })
}

function applySubagentFinished(
  state: SessionStreamState,
  event: Extract<SessionStreamEvent, { kind: "subagent-finished" }>,
): SessionStreamState {
  return updateRunStep(
    state,
    event.runId,
    (step) => step.kind === "subagent" && step.subagent.id === event.subagentId,
    (step) =>
      step.kind === "subagent"
        ? {
            ...step,
            // failed → 失败有归属（替代过去被吞成顶层 run.failed）；否则正常 done。
            subagent: {
              ...step.subagent,
              status: event.failed ? "failed" : "done",
              ...(event.error !== undefined ? { error: event.error } : {}),
            },
          }
        : step,
  )
}

function applySubagentTextDelta(
  state: SessionStreamState,
  event: Extract<SessionStreamEvent, { kind: "subagent-text-delta" }>,
): SessionStreamState {
  return updateRunStep(
    state,
    event.runId,
    (step) => step.kind === "subagent" && step.subagent.id === event.subagentId,
    (step) =>
      step.kind === "subagent"
        ? {
            ...step,
            subagent: {
              ...step.subagent,
              output: `${step.subagent.output ?? ""}${event.text}`,
            },
          }
        : step,
  )
}

function applySubagentTextCompleted(
  state: SessionStreamState,
  event: Extract<SessionStreamEvent, { kind: "subagent-text-completed" }>,
): SessionStreamState {
  return updateRunStep(
    state,
    event.runId,
    (step) => step.kind === "subagent" && step.subagent.id === event.subagentId,
    (step) =>
      step.kind === "subagent"
        ? { ...step, subagent: { ...step.subagent, output: event.text } }
        : step,
  )
}

export function applySessionEvent(
  state: SessionStreamState,
  event: SessionStreamEvent,
): SessionStreamState {
  // 先按 eventId 去重，保证 replay / resume 的幂等收敛。
  if (state.seenEventIds.has(event.eventId)) {
    return state
  }

  let nextState: SessionStreamState = {
    ...state,
    seenEventIds: new Set(state.seenEventIds).add(event.eventId),
    messages: [...state.messages],
    stepsByRun: { ...state.stepsByRun },
  }

  switch (event.kind) {
    // 仅记录 eventId 用于去重，关闭重复 session-created 被重放的隐患。
    case "session-created":
      break
    case "message-delta":
    case "message-completed":
      nextState = applyMessageEvent(nextState, event)
      break
    case "thinking-delta":
      nextState = applyThinkingDelta(nextState, event)
      break
    case "tool-invoked":
      nextState = applyToolInvoked(nextState, event)
      break
    case "tool-awaiting-approval":
      nextState = applyToolAwaitingApproval(nextState, event)
      break
    case "tool-returned":
      nextState = applyToolReturned(nextState, event)
      break
    case "todo-updated":
      // 整表替换：todo.updated 每次携带完整清单，反映当前进度。
      nextState.todos = event.todos
      break
    case "subagent-started":
      nextState = applySubagentStarted(nextState, event)
      break
    case "subagent-finished":
      nextState = applySubagentFinished(nextState, event)
      break
    case "subagent-text-delta":
      nextState = applySubagentTextDelta(nextState, event)
      break
    case "subagent-text-completed":
      nextState = applySubagentTextCompleted(nextState, event)
      break
    case "run-completed":
      nextState = resolveStaleTools(nextState, event.runId)
      nextState.runStatus = "completed"
      break
    case "run-failed":
      nextState = resolveStaleTools(nextState, event.runId)
      nextState.runStatus = "failed"
      break
    default: {
      // 穷尽保护：新增 event.kind 而未在此处理时编译期报错（对齐 mapper 的 exhaustive 风格）。
      const _exhaustive: never = event
      return _exhaustive
    }
  }

  return nextState
}
