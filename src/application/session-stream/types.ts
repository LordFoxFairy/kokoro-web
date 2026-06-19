import type { SessionTodo } from "@/domain/session-stream-event"

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
  // awaiting：被门控工具等待用户批准（HITL）；rejected：用户拒绝了该调用（区别于绿勾的 done）；
  // error：工具失败（errorText 携带原因，落定后保持展开）。
  status: "running" | "awaiting" | "rejected" | "done" | "error"
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

// 有序 Step：过程与文本按发射时序（seq，来自传输游标）排成一列，而非按 kind 归桶。
export type SessionStep =
  | { kind: "thinking"; seq: number; segmentId: string; text: string }
  | { kind: "tool"; seq: number; segmentId: string; tool: SessionToolCall }
  | {
      kind: "subagent"
      seq: number
      segmentId: string
      subagent: SessionSubagent
    }
  | { kind: "text"; seq: number; segmentId: string }

export type SessionStreamState = {
  // 内存用 Set 做 O(1) 去重；落盘序列化为 string[]（见 state-schema）。
  seenEventIds: Set<string>
  messages: SessionMessage[]
  // todo 仍按当前运行整表替换（保留全局 TodoBar，见计划 fork #3）。
  todos: SessionTodo[]
  // 有序步骤：按 runId 归集，每个 run 一条 append-only 的 SessionStep 列表（按 seq 定序）。
  stepsByRun: Record<string, SessionStep[]>
  runStatus: "idle" | "completed" | "failed"
}

// 线程渲染项：连续同 runId 的 assistant 消息归并为一个 turn；用户消息单独成项。
export type ThreadItem =
  | { kind: "user"; message: SessionMessage }
  | {
      kind: "assistant-turn"
      runId: string
      steps: SessionStep[]
      messagesById: Record<string, SessionMessage>
    }
