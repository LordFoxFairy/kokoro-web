import type {
  SessionStreamEvent,
  SessionTodo,
} from "@/domain/shared/session-stream-event"

// 持久化校验（落盘 SessionStreamState 的严格解析）抽到 schema 协作者；re-export 保持调用方稳定。
export {
  parseStoredSessionState,
  storedSessionStateSchema,
} from "./session-stream-state.schema"

export type SessionMessage = {
  id: string
  role: "assistant" | "user"
  content: string
  // 该消息所属 run；用于把同一 run 的连续 assistant 段归并到一个 turn（用户消息为本地 run）。
  runId: string
}

export type SessionToolCall = {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  // error 是段级状态：工具失败时本轮通常仍继续；errorText 携带失败原因，落定后保持展开。
  status: "running" | "done" | "error"
  errorText?: string
}

export type SessionSubagent = {
  id: string
  name: string
  description: string
  subagentType: string
  source: "built-in" | "config-custom" | "runtime-custom"
  output?: string
  status: "running" | "done"
}

// 有序 Step：把一轮的过程（思考/工具/子智能体）与文本按真实发射时序排成一列，
// 而非按 kind 归桶。每个 Step 带 seq（来自传输游标），同一 run 内据此稳定定序。
export type SessionStep =
  | { kind: "thinking"; seq: number; messageId: string; text: string }
  | { kind: "tool"; seq: number; messageId: string; tool: SessionToolCall }
  | {
      kind: "subagent"
      seq: number
      messageId: string
      subagent: SessionSubagent
    }
  | { kind: "text"; seq: number; messageId: string }

// 一轮（run）的派生阶段：thread 据此为每个状态渲染各自非空的存在感。
// idle 等价「无在途」；reconnecting 由 hook 注入（重连续传），其余从 runStatus + 流式信号派生。
export type RunPhase =
  | "idle"
  | "submitted"
  | "streaming"
  | "settling"
  | "complete"
  | "failed"
  | "reconnecting"

export type SessionStreamState = {
  seenEventIds: string[]
  messages: SessionMessage[]
  // todo 仍按当前运行整表替换（保留全局 TodoBar，见计划 fork #3）。
  todos: SessionTodo[]
  // 有序步骤：按 runId 归集，每个 run 一条 append-only 的 SessionStep 列表（按 seq 定序）。
  stepsByRun: Record<string, SessionStep[]>
  runStatus: "idle" | "completed" | "failed"
}

// 活动总量的纯派生信号：跨所有 run 累加思考文本长度、工具数、子智能体数及其输出长度。
// 过程块在静默生长（messages 引用不变）时此值单调增大，供 auto-scroll 的跟随 effect 依赖，
// 让贴底视图也跟上过程块的扩张；它只反映内容多少，不掺引用/顺序噪声。
export function computeActivityVersion(state: SessionStreamState): number {
  let version = 0

  for (const steps of Object.values(state.stepsByRun)) {
    for (const step of steps) {
      if (step.kind === "thinking") {
        version += step.text.length
      } else if (step.kind === "tool") {
        version += 1
        version += step.tool.result?.length ?? 0
      } else if (step.kind === "subagent") {
        version += 1
        version += step.subagent.output?.length ?? 0
      }
    }
  }

  return version
}

// 派生一轮的阶段。reconnecting 由 hook 注入（无法从快照派生），故作为可选信号传入。
export function deriveRunPhase(
  state: SessionStreamState,
  signals: { isStreaming: boolean; isReconnecting?: boolean },
): RunPhase {
  if (signals.isReconnecting) {
    return "reconnecting"
  }
  if (state.runStatus === "failed") {
    return "failed"
  }
  if (signals.isStreaming) {
    // 已出文本即 streaming；流式中但当前 run 尚无任何 step（首 token 未到）为 submitted。
    const activeRunId = lastAssistantRunId(state)
    const hasStep = activeRunId
      ? (state.stepsByRun[activeRunId]?.length ?? 0) > 0
      : false
    return hasStep ? "streaming" : "submitted"
  }
  if (state.runStatus === "completed") {
    return "complete"
  }
  return "idle"
}

function lastAssistantRunId(state: SessionStreamState): string | undefined {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const message = state.messages[i]
    if (message?.role === "assistant") {
      return message.runId
    }
  }
  return undefined
}

// 线程渲染项：要么一条用户气泡，要么一轮 assistant（一个 runId 的有序步骤 + 该轮文本段的索引）。
// 把「连续同 runId 的 assistant 消息」归并到一个 turn；用户消息单独成项，作为 turn 之上的提问。
export type ThreadItem =
  | { kind: "user"; message: SessionMessage }
  | {
      kind: "assistant-turn"
      runId: string
      steps: SessionStep[]
      messagesById: Record<string, SessionMessage>
    }

// 持久化/legacy 恢复时只回放了 messages、未回放有序步骤：为缺少 text 步骤的 assistant 段
// 补一个合成 text 步骤（seq 接在已有步骤之后，按段出现顺序），保证刷新后答案仍被渲染。
function withRestoredTextSteps(
  steps: SessionStep[],
  messagesById: Record<string, SessionMessage>,
): SessionStep[] {
  const covered = new Set(
    steps.filter((step) => step.kind === "text").map((step) => step.messageId),
  )
  const missing = Object.keys(messagesById).filter((id) => !covered.has(id))
  if (missing.length === 0) {
    return steps
  }
  let nextSeq = steps.reduce((max, step) => Math.max(max, step.seq), 0)
  const synthetic: SessionStep[] = missing.map((messageId) => {
    nextSeq += 1
    return { kind: "text", seq: nextSeq, messageId }
  })
  return [...steps, ...synthetic]
}

export function buildThreadItems(state: SessionStreamState): ThreadItem[] {
  const items: ThreadItem[] = []
  const renderedRuns = new Set<string>()
  let i = 0

  while (i < state.messages.length) {
    const message = state.messages[i] as SessionMessage

    if (message.role === "user") {
      items.push({ kind: "user", message })
      i += 1
      continue
    }

    // 收拢连续的同 runId assistant 消息，组成一个 turn 的文本段索引。
    const runId = message.runId
    const messagesById: Record<string, SessionMessage> = {}
    while (i < state.messages.length) {
      const candidate = state.messages[i] as SessionMessage
      if (candidate.role !== "assistant" || candidate.runId !== runId) {
        break
      }
      messagesById[candidate.id] = candidate
      i += 1
    }

    renderedRuns.add(runId)
    items.push({
      kind: "assistant-turn",
      runId,
      steps: withRestoredTextSteps(state.stepsByRun[runId] ?? [], messagesById),
      messagesById,
    })
  }

  // 仅有过程步骤、尚无任何 assistant 文本的 run（首 token 未到）：作为一个无文本的成形 turn。
  for (const runId of Object.keys(state.stepsByRun)) {
    if (renderedRuns.has(runId)) {
      continue
    }
    items.push({
      kind: "assistant-turn",
      runId,
      steps: state.stepsByRun[runId] ?? [],
      messagesById: {},
    })
  }

  return items
}

export function createSessionStreamState(): SessionStreamState {
  return {
    seenEventIds: [],
    messages: [],
    todos: [],
    stepsByRun: {},
    runStatus: "idle",
  }
}

// 在某 run 的有序步骤列表里按 seq 插入/合并一个新步骤。insertOrdered 保证列表始终按
// (seq, 到达先后) 稳定有序：同 seq 追加在已有同 seq 之后，保持 append 语义。
function insertOrdered(
  steps: SessionStep[],
  step: SessionStep,
): SessionStep[] {
  const next = [...steps]
  // 从尾部找到第一个 seq <= 新步骤 seq 的位置之后插入（稳定：同 seq 排到既有之后）。
  let index = next.length
  while (index > 0 && (next[index - 1]?.seq ?? 0) > step.seq) {
    index -= 1
  }
  next.splice(index, 0, step)
  return next
}

// 在某 run 的步骤列表里就地更新一个已存在的步骤（按谓词定位），不改变其位置。
// 用于 tool.returned 把同一 tool step 由 running 翻 done、subagent 续写 output 等。
function updateRunStep(
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

function appendRunStep(
  state: SessionStreamState,
  runId: string,
  step: SessionStep,
): SessionStreamState {
  const steps = state.stepsByRun[runId] ?? []
  return {
    ...state,
    stepsByRun: { ...state.stepsByRun, [runId]: insertOrdered(steps, step) },
  }
}

export function applySessionEvent(
  state: SessionStreamState,
  event: SessionStreamEvent,
): SessionStreamState {
  // 先按 eventId 去重，保证 replay / resume 的幂等收敛。
  if (state.seenEventIds.includes(event.eventId)) {
    return state
  }

  let nextState: SessionStreamState = {
    ...state,
    seenEventIds: [...state.seenEventIds, event.eventId],
    messages: [...state.messages],
    stepsByRun: { ...state.stepsByRun },
  }

  if (event.kind === "session-created") {
    // 仅记录 eventId 用于去重，关闭重复 session-created 被重放的隐患。
    return nextState
  }

  if (event.kind === "message-delta" || event.kind === "message-completed") {
    const index = nextState.messages.findIndex(
      (message) => message.id === event.messageId,
    )

    if (event.kind === "message-delta") {
      if (index >= 0) {
        const existing = nextState.messages[index]
        // role/runId 在 messageId 首个增量时确定一次：后续增量只追加正文。
        nextState.messages[index] = {
          ...(existing as SessionMessage),
          content: `${existing?.content ?? ""}${event.delta}`,
        }
      } else {
        nextState.messages.push({
          id: event.messageId,
          role: event.role,
          content: event.delta,
          runId: event.runId,
        })
        // 文本步骤进入有序列表：标记「这一段文本在此 seq 出现」，渲染时据此与过程交错。
        nextState = appendRunStep(nextState, event.runId, {
          kind: "text",
          seq: event.seq,
          messageId: event.messageId,
        })
      }
    } else {
      // completed 必须覆盖累计增量，避免 replay 后残留半句内容。
      if (index >= 0) {
        nextState.messages[index] = {
          id: event.messageId,
          role: event.role,
          content: event.content,
          runId: event.runId,
        }
      } else {
        nextState.messages.push({
          id: event.messageId,
          role: event.role,
          content: event.content,
          runId: event.runId,
        })
        nextState = appendRunStep(nextState, event.runId, {
          kind: "text",
          seq: event.seq,
          messageId: event.messageId,
        })
      }
    }
  }

  if (event.kind === "thinking-delta") {
    const steps = nextState.stepsByRun[event.runId] ?? []
    // 同一段 thinking 续写：找该 messageId 的既有 thinking step 追加，否则新建一个有序步骤。
    const existingIndex = steps.findIndex(
      (step) => step.kind === "thinking" && step.messageId === event.messageId,
    )
    if (existingIndex >= 0) {
      const existing = steps[existingIndex]
      if (existing?.kind === "thinking") {
        nextState = updateRunStep(
          nextState,
          event.runId,
          (step) => step === existing,
          (step) =>
            step.kind === "thinking"
              ? { ...step, text: `${step.text}${event.delta}` }
              : step,
        )
      }
    } else {
      nextState = appendRunStep(nextState, event.runId, {
        kind: "thinking",
        seq: event.seq,
        messageId: event.messageId,
        text: event.delta,
      })
    }
  }

  if (event.kind === "tool-invoked") {
    nextState = appendRunStep(nextState, event.runId, {
      kind: "tool",
      seq: event.seq,
      messageId: event.messageId,
      tool: {
        id: event.toolId,
        name: event.name,
        args: event.args,
        status: "running",
      },
    })
  }

  if (event.kind === "tool-returned") {
    const steps = nextState.stepsByRun[event.runId] ?? []
    const hasInvoked = steps.some(
      (step) => step.kind === "tool" && step.tool.id === event.toolId,
    )
    if (hasInvoked) {
      // 配对：把同一 tool step 由 running 就地翻 done，保持原位置（不重排）。
      nextState = updateRunStep(
        nextState,
        event.runId,
        (step) => step.kind === "tool" && step.tool.id === event.toolId,
        (step) =>
          step.kind === "tool"
            ? {
                ...step,
                tool: { ...step.tool, result: event.result, status: "done" },
              }
            : step,
      )
    } else {
      // 无配对的 invoked（如部分 replay）：仍记录已完成的结果，不丢事件。
      nextState = appendRunStep(nextState, event.runId, {
        kind: "tool",
        seq: event.seq,
        messageId: event.messageId,
        tool: {
          id: event.toolId,
          name: event.name,
          args: {},
          result: event.result,
          status: "done",
        },
      })
    }
  }

  if (event.kind === "todo-updated") {
    // 整表替换：todo.updated 每次携带完整清单，反映当前进度。
    nextState.todos = event.todos
  }

  if (event.kind === "subagent-started") {
    nextState = appendRunStep(nextState, event.runId, {
      kind: "subagent",
      seq: event.seq,
      messageId: event.messageId,
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

  if (event.kind === "subagent-finished") {
    nextState = updateRunStep(
      nextState,
      event.runId,
      (step) => step.kind === "subagent" && step.subagent.id === event.subagentId,
      (step) =>
        step.kind === "subagent"
          ? { ...step, subagent: { ...step.subagent, status: "done" } }
          : step,
    )
  }

  if (event.kind === "subagent-text-delta") {
    nextState = updateRunStep(
      nextState,
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

  if (event.kind === "subagent-text-completed") {
    nextState = updateRunStep(
      nextState,
      event.runId,
      (step) => step.kind === "subagent" && step.subagent.id === event.subagentId,
      (step) =>
        step.kind === "subagent"
          ? { ...step, subagent: { ...step.subagent, output: event.text } }
          : step,
    )
  }

  if (event.kind === "run-completed") {
    nextState.runStatus = "completed"
  }

  if (event.kind === "run-failed") {
    nextState.runStatus = "failed"
  }

  return nextState
}

// 协议只流式 assistant 消息；用户自己的输入是本地产生的，永不会被服务端 replay，
// 因此不进入 seenEventIds 去重表，只作为一条用户气泡追加进持久会话线。
// 上一轮终态（completed/failed）复位为 idle，避免新问题尚未开始时继续挂着旧终态；
// todo 整表清空（保留全局 TodoBar 的当轮语义）。历史 run 的有序步骤全部保留，供 thread/replay/render。
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
