// 纯状态模型：零 I/O 零 React；词汇直接取自 contract（z.infer 即领域类型）。

import type { SessionEvent } from "@/contract/session-events"

type EventOf<K extends SessionEvent["kind"]> = Extract<SessionEvent, { kind: K }>

export type SessionTodo = EventOf<"todo.updated">["payload"]["todos"][number]
export type AllowedDecision =
  EventOf<"tool.awaiting_approval">["payload"]["allowed_decisions"][number]
export type AwaitingKind = EventOf<"tool.awaiting_approval">["payload"]["kind"]
export type ToolRisk = NonNullable<EventOf<"tool.awaiting_approval">["payload"]["risk"]>
export type SubagentSource = EventOf<"subagent.started">["payload"]["source"]
export type RunCompletedStatus = EventOf<"run.completed">["payload"]["status"]
export type RunErrorCode = EventOf<"run.failed">["payload"]["code"]

export type SessionMessage = {
  id: string
  role: "assistant" | "user"
  content: string
  // 该消息所属 run；用于把同一 run 的连续 assistant 段归并到一个 turn（用户消息以自身 id 充当）。
  runId: string
  // snapshot 水合出的在途 assistant 占位：首个后续文本事件按 run 认领它续写（认领即摘除标记）。
}

// 结构化终态收口：stale-*（run 终态时仍悬挂）与 cancelled（用户停止）零 UI 文案，人话由渲染层生成。
export type ToolStatus =
  | "running"
  | "awaiting"
  | "rejected"
  | "done"
  | "error"
  | "stale-awaiting"
  | "stale-running"
  | "cancelled"

export type SessionToolCall = {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  status: ToolStatus
  // 仅真实工具失败（is_error=true）时携带，与合成收口状态严格分离。
  errorText?: string
  rejectReason?: string
  responded?: boolean
  description?: string
  allowedDecisions?: AllowedDecision[]
  awaitingKind?: AwaitingKind
  // 契约 risk：面向 web 的风险摘要，非权限判断真源。
  risk?: ToolRisk
  editable?: boolean
  inputSchema?: Record<string, unknown>
  // 契约 pending_tool_ids：同帧完整待批集合，HITL「凑齐才提交」的唯一判据。
  pendingToolIds?: string[]
}

export type SessionSubagent = {
  id: string
  name: string
  description: string
  subagentType: string
  source: SubagentSource
  output?: string
  status: "running" | "done" | "failed"
  error?: string
}

// 有序 Step：过程与文本按 session 落定的 seq 排成一列，而非按 kind 归桶。
export type SessionStep =
  | { kind: "thinking"; seq: number; segmentId: string; text: string }
  | { kind: "tool"; seq: number; segmentId: string; tool: SessionToolCall }
  | { kind: "subagent"; seq: number; segmentId: string; subagent: SessionSubagent }
  | { kind: "text"; seq: number; segmentId: string }

// session.created 投影：sessions 集合的真实元数据（标题真源在服务端）。
export type SessionMeta = {
  title: string
  ownerId: string
}

export type WorkspaceFileEntry = {
  path: string
  mime: string
  bytes: number
}

export type SessionStreamState = {
  // 工作区文件清单（snapshot 水合；终态后重拉刷新）。
  files: WorkspaceFileEntry[]
  // 内存去重 Set：event_id 幂等（本页生命周期内；权威历史由 snapshot 水位截断）。
  seenEventIds: Set<string>
  messages: SessionMessage[]
  todos: SessionTodo[]
  stepsByRun: Record<string, SessionStep[]>
  runStatus: "idle" | RunCompletedStatus | "failed"
  // 最近一次 run.failed 的契约三层错误（code=按码文案键 / message=兜底原文）；非失败态恒 null。
  runError: { code: RunErrorCode; message: string } | null
  // 在途 run 显式字段：snapshot 水合置位、匹配终态清空。
  activeRunId: string | null
  // 已折叠到的最大 seq（snapshot 水位起步）：续流时过滤重放，非业务排序 cursor。
  lastSeq: number
  meta: SessionMeta | null
}

export function createSessionStreamState(): SessionStreamState {
  return {
    files: [],
    seenEventIds: new Set(),
    messages: [],
    todos: [],
    stepsByRun: {},
    runStatus: "idle",
    runError: null,
    activeRunId: null,
    lastSeq: 0,
    meta: null,
  }
}
