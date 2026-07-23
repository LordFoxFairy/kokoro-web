// 事件折叠：event_id 幂等去重 + 批量折叠（可变草稿一次快照）+ never 穷尽守卫。

import type { SessionEvent } from "@/contract/session-events"

import type {
  SessionStep,
  SessionStreamState,
  SessionToolCall,
  ToolStatus,
} from "./state"

type EventOf<K extends SessionEvent["kind"]> = Extract<SessionEvent, { kind: K }>

// 批内草稿：seenEventIds/messages/stepsByRun 顶层已复制；每个 run 的步骤数组首次触碰时复制一次。
type Draft = {
  state: SessionStreamState
  touchedRuns: Set<string>
}

function stepsOf(draft: Draft, runId: string): SessionStep[] {
  if (!draft.touchedRuns.has(runId)) {
    draft.state.stepsByRun[runId] = [...(draft.state.stepsByRun[runId] ?? [])]
    draft.touchedRuns.add(runId)
  }
  return draft.state.stepsByRun[runId] ?? []
}

// 按 (seq, 到达先后) 稳定就地插入：同 seq 追加在既有之后，保持 append 语义。
function insertOrdered(steps: SessionStep[], step: SessionStep): void {
  let index = steps.length
  while (index > 0 && (steps[index - 1]?.seq ?? 0) > step.seq) {
    index -= 1
  }
  steps.splice(index, 0, step)
}

function updateStep(
  steps: SessionStep[],
  predicate: (step: SessionStep) => boolean,
  updater: (step: SessionStep) => SessionStep,
): boolean {
  const index = steps.findIndex(predicate)
  if (index < 0) {
    return false
  }
  const existing = steps[index]
  if (existing !== undefined) {
    steps[index] = updater(existing)
  }
  return true
}

function applyAssistantText(
  draft: Draft,
  event: EventOf<"message.delta"> | EventOf<"message.completed">,
): void {
  const { messages } = draft.state
  const segmentId = event.payload.segment_id
  const incoming = event.kind === "message.completed" ? event.payload.content : event.payload.delta
  const index = messages.findIndex((message) => message.id === segmentId)
  if (index >= 0) {
    const existing = messages[index]
    if (existing !== undefined) {
      // completed 覆盖累计增量（replay 后不残留半句）；delta 追加。
      const content =
        event.kind === "message.completed" ? incoming : `${existing.content}${incoming}`
      messages[index] = { ...existing, content }
    }
    return
  }
  messages.push({
    id: segmentId,
    role: "assistant",
    content: incoming,
    runId: event.run_id,
  })
  // 文本步骤进入有序列表：标记「这一段文本在此 seq 出现」，渲染时与过程交错。
  insertOrdered(stepsOf(draft, event.run_id), {
    kind: "text",
    seq: event.seq,
    segmentId,
  })
}

function applyThinkingDelta(draft: Draft, event: EventOf<"thinking.delta">): void {
  const steps = stepsOf(draft, event.run_id)
  const segmentId = event.payload.segment_id
  const updated = updateStep(
    steps,
    (step) => step.kind === "thinking" && step.segmentId === segmentId,
    (step) =>
      step.kind === "thinking" ? { ...step, text: `${step.text}${event.payload.delta}` } : step,
  )
  if (!updated) {
    insertOrdered(steps, {
      kind: "thinking",
      seq: event.seq,
      segmentId,
      text: event.payload.delta,
    })
  }
}

function applyToolInvoked(draft: Draft, event: EventOf<"tool.invoked">): void {
  const steps = stepsOf(draft, event.run_id)
  const payload = event.payload
  // 审批后的 invoked 复用既有步（保留 awaiting 的 seq/segment）：一次工具调用恒为一个步，
  // 即便 agent 的 invoked/returned segment 与 awaiting 漂移（真栈走查抓获的重复渲染）。
  const updated = updateStep(
    steps,
    (step) => step.kind === "tool" && step.tool.id === payload.tool_id,
    (step) =>
      step.kind === "tool"
        ? { ...step, tool: { ...step.tool, args: payload.args, status: "running" } }
        : step,
  )
  if (!updated) {
    insertOrdered(steps, {
      kind: "tool",
      seq: event.seq,
      segmentId: payload.segment_id,
      tool: {
        id: payload.tool_id,
        name: payload.name,
        args: payload.args,
        status: "running",
      },
    })
  }
}

function applyToolAwaitingApproval(
  draft: Draft,
  event: EventOf<"tool.awaiting_approval">,
): void {
  const steps = stepsOf(draft, event.run_id)
  const payload = event.payload
  const meta = {
    description: payload.description,
    allowedDecisions: [...payload.allowed_decisions],
    awaitingKind: payload.kind,
    editable: payload.editable,
    pendingToolIds: [...payload.pending_tool_ids],
    ...(payload.risk !== undefined ? { risk: payload.risk } : {}),
    ...(payload.input_schema !== undefined ? { inputSchema: payload.input_schema } : {}),
    // result_review：工具已执行的待审结果预填 result，审核卡只读展示；returned 回流后覆盖为裁决结果。
    ...(payload.result !== undefined ? { result: payload.result } : {}),
  }
  const updated = updateStep(
    steps,
    (step) => step.kind === "tool" && step.tool.id === payload.tool_id,
    (step) =>
      step.kind === "tool"
        ? // args 一并刷新：kind=input 校验失败重问时 validation_error 随 args 重发（同 tool_id）。
          { ...step, tool: { ...step.tool, args: payload.args, status: "awaiting", ...meta } }
        : step,
  )
  if (!updated) {
    // 无配对的 invoked（乱序/部分 replay）：补建 awaiting 步，防止审批 UI 丢失。
    insertOrdered(steps, {
      kind: "tool",
      seq: event.seq,
      segmentId: payload.segment_id,
      tool: {
        id: payload.tool_id,
        name: payload.name,
        args: payload.args,
        status: "awaiting",
        ...meta,
      },
    })
  }
}

function applyToolReturned(draft: Draft, event: EventOf<"tool.returned">): void {
  const steps = stepsOf(draft, event.run_id)
  const payload = event.payload
  // rejected（HITL 拒绝，含超时回退）→ rejected（replay 安全，区别于绿勾 done）；is_error → error。
  const returnedStatus: ToolStatus = payload.rejected
    ? "rejected"
    : payload.is_error
      ? "error"
      : "done"
  const resultFields = {
    result: payload.result,
    ...(payload.is_error ? { errorText: payload.result } : {}),
    ...(payload.reject_reason !== undefined ? { rejectReason: payload.reject_reason } : {}),
    ...(payload.responded !== undefined ? { responded: payload.responded } : {}),
  }
  const updated = updateStep(
    steps,
    (step) => step.kind === "tool" && step.tool.id === payload.tool_id,
    (step) =>
      step.kind === "tool"
        ? {
            ...step,
            tool: {
              ...step.tool,
              ...resultFields,
              // 已置 rejected 的工具：回流（is_error=false 的拒绝文案）不得把 rejected 降级为 done。
              status: step.tool.status === "rejected" ? "rejected" : returnedStatus,
            },
          }
        : step,
  )
  if (!updated) {
    // 无配对的 invoked（部分 replay）：仍记录已完成的结果，不丢事件。
    insertOrdered(steps, {
      kind: "tool",
      seq: event.seq,
      segmentId: payload.segment_id,
      tool: { id: payload.tool_id, name: payload.name, args: {}, status: returnedStatus, ...resultFields },
    })
  }
}

function applySubagentStarted(draft: Draft, event: EventOf<"subagent.started">): void {
  insertOrdered(stepsOf(draft, event.run_id), {
    kind: "subagent",
    seq: event.seq,
    segmentId: event.payload.segment_id,
    subagent: {
      id: event.payload.subagent_id,
      name: event.payload.name,
      description: event.payload.description,
      subagentType: event.payload.subagent_type,
      source: event.payload.source,
      status: "running",
    },
  })
}

function updateSubagent(
  draft: Draft,
  runId: string,
  subagentId: string,
  updater: (subagent: SessionStep & { kind: "subagent" }) => SessionStep,
): void {
  updateStep(
    stepsOf(draft, runId),
    (step) => step.kind === "subagent" && step.subagent.id === subagentId,
    (step) => (step.kind === "subagent" ? updater(step) : step),
  )
}

// run 终态时把悬挂工具置结构化 stale 状态：避免永久挂起的批准按钮，文案由渲染层生成。
function settleOpenTool(
  tool: SessionToolCall,
  close: (status: "running" | "awaiting") => ToolStatus,
): SessionToolCall | null {
  if (tool.status !== "running" && tool.status !== "awaiting") {
    return null
  }
  return { ...tool, status: close(tool.status) }
}

function closeOpenTools(
  steps: SessionStep[],
  close: (status: "running" | "awaiting") => ToolStatus,
): SessionStep[] | null {
  let changed = false
  const next = steps.map((step) => {
    if (step.kind !== "tool") {
      return step
    }
    const settled = settleOpenTool(step.tool, close)
    if (!settled) {
      return step
    }
    changed = true
    return { ...step, tool: settled }
  })
  return changed ? next : null
}

function applyRunTerminal(
  draft: Draft,
  event: EventOf<"run.completed"> | EventOf<"run.failed">,
): void {
  const steps = stepsOf(draft, event.run_id)
  const closed = closeOpenTools(steps, (status) =>
    status === "awaiting" ? "stale-awaiting" : "stale-running",
  )
  if (closed) {
    draft.state.stepsByRun[event.run_id] = closed
  }
  // 全局 runStatus/runError 是「当前/最近一轮」的单槽投影：仅在无在途锚点（live 收口，
  // activeRunId 恒 null）或该终态正属在途 run 时才写；reattach 全量回放里历史 run 的终态
  // 不得覆写在途 run，否则在途 run 若走客户端 TIMEOUT 收口就会弹出历史 run 的假失败卡。
  if (draft.state.activeRunId === null || draft.state.activeRunId === event.run_id) {
    draft.state.runStatus =
      event.kind === "run.completed" ? event.payload.status : "failed"
    draft.state.runError =
      event.kind === "run.failed"
        ? { code: event.payload.code, message: event.payload.message }
        : null
  }
  if (draft.state.activeRunId === event.run_id) {
    draft.state.activeRunId = null
  }
}

function applyEvent(draft: Draft, event: SessionEvent): void {
  switch (event.kind) {
    case "session.created":
      // sessions 集合真实元数据投影：标题真源在服务端。
      draft.state.meta = {
        title: event.payload.title,
        ownerId: event.payload.owner_id,
      }
      break
    case "run.created":
      // 契约要求解析（event_id/seq 照常记账），不做投影：run 锚定由 receipt/snapshot 承担。
      break
    case "message.user": {
      // user 消息事件三态：id 命中 → 更新；本地 echo 尚未被 receipt 对齐（SSE 跑赢 HTTP
      // 回执，steer 路径常态）→ 就地吸收改 id；都没有（刷新回放）→ 新建。
      const { messages } = draft.state
      const index = messages.findIndex((m) => m.id === event.payload.message_id)
      if (index >= 0) {
        const existing = messages[index]
        if (existing !== undefined) {
          messages[index] = { ...existing, content: event.payload.content }
        }
        break
      }
      const echoIndex = messages.findLastIndex(
        (m) => m.role === "user" && m.id.startsWith("usr_") && m.content === event.payload.content,
      )
      const echo = echoIndex >= 0 ? messages[echoIndex] : undefined
      if (echo !== undefined) {
        messages[echoIndex] = { ...echo, id: event.payload.message_id, runId: event.run_id }
      } else {
        messages.push({
          id: event.payload.message_id,
          role: "user",
          content: event.payload.content,
          runId: event.run_id,
        })
      }
      break
    }
    case "message.delta":
    case "message.completed":
      applyAssistantText(draft, event)
      break
    case "thinking.delta":
      applyThinkingDelta(draft, event)
      break
    case "tool.invoked":
      applyToolInvoked(draft, event)
      break
    case "tool.output.delta":
      // 长执行工具增量：V1 不渲染（终值走 tool.returned）；canvas/终端视图（P1）再消费。
      break
    case "tool.awaiting_approval":
      applyToolAwaitingApproval(draft, event)
      break
    case "tool.returned":
      applyToolReturned(draft, event)
      break
    case "todo.updated":
      // 整表替换：todo.updated 每次携带完整清单。
      draft.state.todos = event.payload.todos
      break
    case "subagent.started":
      applySubagentStarted(draft, event)
      break
    case "subagent.finished":
      updateSubagent(draft, event.run_id, event.payload.subagent_id, (step) => ({
        ...step,
        subagent: {
          ...step.subagent,
          status: event.payload.failed ? "failed" : "done",
          ...(event.payload.error !== undefined ? { error: event.payload.error } : {}),
        },
      }))
      break
    case "subagent.thinking.delta":
      // 穷尽 switch 须显式接收；子代理推理增量无消费视图，不参与状态归约。
      break
    case "subagent.text.delta":
      updateSubagent(draft, event.run_id, event.payload.subagent_id, (step) => ({
        ...step,
        subagent: {
          ...step.subagent,
          output: `${step.subagent.output ?? ""}${event.payload.text}`,
        },
      }))
      break
    case "subagent.text.completed":
      updateSubagent(draft, event.run_id, event.payload.subagent_id, (step) => ({
        ...step,
        subagent: { ...step.subagent, output: event.payload.text },
      }))
      break
    case "subagent.tool.invoked":
    case "subagent.tool.returned":
      // 穷尽 switch 须显式接收；当前无子代理详情视图消费此通道，不参与状态归约。
      break
    case "delivery.created": {
      // 成果累积：contentHash 内容寻址幂等（重放/乱序重复投递只入账一次）。
      const payload = event.payload
      if (draft.state.deliveries.some((d) => d.contentHash === payload.content_hash)) {
        break
      }
      draft.state.deliveries = [
        ...draft.state.deliveries,
        {
          contentHash: payload.content_hash,
          path: payload.path,
          title: payload.title,
          mime: payload.mime,
          size: payload.size,
          createdAt: event.timestamp,
          ...(payload.note !== undefined ? { note: payload.note } : {}),
        },
      ]
      break
    }
    case "run.completed":
    case "run.failed":
      applyRunTerminal(draft, event)
      break
    default: {
      // 穷尽保护：契约新增 kind 而未在此处理时编译期报错。
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

// 批量折叠：整批只做一次顶层快照，逐事件在可变草稿上折叠（修 replay O(n²)）；
// 全部重复（event_id 已见）时原样返回入参 state，保证幂等判定可用引用相等表达。
export function applySessionEvents(
  state: SessionStreamState,
  events: readonly SessionEvent[],
): SessionStreamState {
  let draft: Draft | null = null
  for (const event of events) {
    const base = draft?.state ?? state
    if (base.seenEventIds.has(event.event_id)) {
      continue
    }
    if (!draft) {
      draft = {
        state: {
          seenEventIds: new Set(state.seenEventIds),
          messages: [...state.messages],
          todos: state.todos,
          stepsByRun: { ...state.stepsByRun },
          files: state.files,
          deliveries: state.deliveries,
          runStatus: state.runStatus,
          runError: state.runError,
          activeRunId: state.activeRunId,
          lastSeq: state.lastSeq,
          meta: state.meta,
        },
        touchedRuns: new Set(),
      }
    }
    draft.state.seenEventIds.add(event.event_id)
    if (event.seq > draft.state.lastSeq) {
      draft.state.lastSeq = event.seq
    }
    applyEvent(draft, event)
  }
  return draft?.state ?? state
}

export function applySessionEvent(
  state: SessionStreamState,
  event: SessionEvent,
): SessionStreamState {
  return applySessionEvents(state, [event])
}

// —— 本地命令（非事件折叠）：用户动作驱动的纯状态迁移 ——

// 用户输入本地产生、不进 seenEventIds；复位 runStatus 并清空 todo，历史步骤保留。
export function appendUserMessage(
  state: SessionStreamState,
  message: { id: string; content: string },
): SessionStreamState {
  return {
    ...state,
    messages: [
      ...state.messages,
      // 用户消息用自身 id 作 runId：投影据此把它与任一 assistant run 隔开，单独成行。
      { id: message.id, role: "user", content: message.content, runId: message.id },
    ],
    todos: [],
    runStatus: "idle",
    runError: null,
  }
}

// HITL：用户点「拒绝」时本地乐观把该 run 指定工具置 rejected（防拒绝回流被翻成绿勾 done）。
// 只翻命中且仍 awaiting 的工具——同帧部分拒绝时，批准的工具不受影响继续运行。
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

// 用户停止在途 run 的本地收口：悬挂工具置结构化 cancelled（停止即关流，后端终态来不及回流）。
export function markRunCancelled(
  state: SessionStreamState,
  runId: string,
): SessionStreamState {
  const steps = state.stepsByRun[runId]
  if (!steps) {
    return state
  }
  const closed = closeOpenTools(steps, () => "cancelled")
  if (!closed) {
    return state
  }
  return { ...state, stepsByRun: { ...state.stepsByRun, [runId]: closed } }
}
