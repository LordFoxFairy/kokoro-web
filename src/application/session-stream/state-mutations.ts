import type { SessionStep, SessionStreamState } from "./types"

export function createSessionStreamState(): SessionStreamState {
  return {
    seenEventIds: new Set(),
    messages: [],
    todos: [],
    stepsByRun: {},
    runStatus: "idle",
  }
}

// 就地更新已存在的步骤（按谓词定位）而不改其位置：tool 翻 done、subagent 续写 output 等。
export function updateRunStep(
  state: SessionStreamState,
  runId: string,
  predicate: (step: SessionStep) => boolean,
  updater: (step: SessionStep) => SessionStep,
): SessionStreamState {
  const steps = state.stepsByRun[runId]
  if (!steps) {
    return state
  }
  const index = steps.findIndex(predicate)
  if (index < 0) {
    return state
  }
  const nextSteps = [...steps]
  nextSteps[index] = updater(nextSteps[index] as SessionStep)
  return {
    ...state,
    stepsByRun: { ...state.stepsByRun, [runId]: nextSteps },
  }
}

export function appendRunStep(
  state: SessionStreamState,
  runId: string,
  step: SessionStep,
): SessionStreamState {
  const steps = state.stepsByRun[runId] ?? []
  return {
    ...state,
    stepsByRun: { ...state.stepsByRun, [runId]: [...steps, step] },
  }
}

// 最近开始的 run（stepsByRun 按插入序，末位即最新）：停止/放弃时据此取消在途 run。
export function findActiveRunId(state: SessionStreamState): string | null {
  const runIds = Object.keys(state.stepsByRun)
  return runIds[runIds.length - 1] ?? null
}

// HITL：用户点「拒绝」时本地乐观把该 run 指定工具置 rejected（区别于 reject 回流的 is_error=false 绿勾）。
// 只翻 toolIds 命中且仍 awaiting 的工具——同帧多工具部分审批时，批准的工具不受影响继续运行。
export function markToolRejected(
  state: SessionStreamState,
  runId: string,
  toolIds: readonly string[],
): SessionStreamState {
  const steps = state.stepsByRun[runId]
  if (!steps) {
    return state
  }
  const rejectSet = new Set(toolIds)
  let changed = false
  const next = steps.map((step) => {
    if (step.kind === "tool" && step.tool.status === "awaiting" && rejectSet.has(step.tool.id)) {
      changed = true
      return { ...step, tool: { ...step.tool, status: "rejected" as const } }
    }
    return step
  })
  if (!changed) {
    return state
  }
  return { ...state, stepsByRun: { ...state.stepsByRun, [runId]: next } }
}

// 把该 run 残留的 running/awaiting 工具就地翻 error（done/error 工具不动）；文案由调用方按档位决定。
function resolveOpenTools(
  state: SessionStreamState,
  runId: string,
  errorTextFor: (status: "running" | "awaiting") => string,
): SessionStreamState {
  const steps = state.stepsByRun[runId]
  if (!steps) {
    return state
  }
  let changed = false
  const resolved = steps.map((step) => {
    if (
      step.kind === "tool" &&
      (step.tool.status === "running" || step.tool.status === "awaiting")
    ) {
      changed = true
      return {
        ...step,
        tool: {
          ...step.tool,
          status: "error" as const,
          errorText: errorTextFor(step.tool.status),
        },
      }
    }
    return step
  })
  if (!changed) {
    return state
  }
  return { ...state, stepsByRun: { ...state.stepsByRun, [runId]: resolved } }
}

// run 终态时将残留的 running/awaiting 工具置为 error，避免永久挂起的「待批准/运行中」行及无人消费的批准按钮。
export function resolveStaleTools(
  state: SessionStreamState,
  runId: string,
): SessionStreamState {
  return resolveOpenTools(state, runId, (status) =>
    status === "awaiting" ? "运行已结束，该工具未获批准" : "运行已结束，工具未完成",
  )
}

// 用户停止/放弃在途 run 时本地收口：把残留的 running/awaiting 工具翻 error「运行已取消」，
// 避免停止后还挂着一组无人消费的批准按钮（停止会立即关 SSE，后端 cancelled 终态来不及回流）。
export function markRunCancelled(
  state: SessionStreamState,
  runId: string,
): SessionStreamState {
  return resolveOpenTools(state, runId, () => "运行已取消")
}

// 用户输入本地产生、不进 seenEventIds；复位 runStatus 为 idle 并清空 todo，历史步骤保留。
export function appendUserMessage(
  state: SessionStreamState,
  message: { id: string; content: string },
): SessionStreamState {
  return {
    ...state,
    messages: [
      ...state.messages,
      // 用户消息用自身 id 作 runId：grouping 据此把它与任一 assistant run 隔开，单独成行。
      { id: message.id, role: "user", content: message.content, runId: message.id },
    ],
    todos: [],
    runStatus: "idle",
  }
}
