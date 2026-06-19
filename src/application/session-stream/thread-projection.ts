import type {
  SessionMessage,
  SessionStep,
  SessionStreamState,
  SessionSubagent,
  SessionToolCall,
  ThreadItem,
} from "./types"

// 活动总量的纯派生信号（思考长度+工具/子智能体数+输出长度）：供 auto-scroll 跟随过程块的静默生长。
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

// legacy 恢复只回放了 messages：为缺 text 步骤的 assistant 段补合成 text 步骤，保证刷新后答案仍被渲染。
function withRestoredTextSteps(
  steps: SessionStep[],
  messagesById: Record<string, SessionMessage>,
): SessionStep[] {
  const covered = new Set(
    steps.filter((step) => step.kind === "text").map((step) => step.segmentId),
  )
  const missing = Object.keys(messagesById).filter((id) => !covered.has(id))
  if (missing.length === 0) {
    return steps
  }
  let nextSeq = steps.reduce((max, step) => Math.max(max, step.seq), 0)
  const synthetic: SessionStep[] = missing.map((segmentId) => {
    nextSeq += 1
    return { kind: "text", seq: nextSeq, segmentId }
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

// 一个 turn 内按 segmentId 聚合的视图段：思考/工具/子智能体归到「催生其后那段答案」的过程下。
export type Segment = {
  segmentId: string
  thinking: string
  tools: SessionToolCall[]
  subagents: SessionSubagent[]
}

// 按 segmentId 把有序步骤分段，保持「首次出现」顺序（即真实发生时序）；
// 每段聚合它自己的思考/工具/子智能体。工具属于它后面那段文本（由 segment_id 归属保证），
// 因此每段的过程正好是「催生这段答案」的那批过程。
export function groupSegments(steps: SessionStep[]): Segment[] {
  // ordered 保留首次出现顺序；byId 仅做去重定位，二者指向同一对象——避免回读时的非空断言。
  const ordered: Segment[] = []
  const byId = new Map<string, Segment>()
  const segmentFor = (id: string): Segment => {
    const existing = byId.get(id)
    if (existing) {
      return existing
    }
    const created: Segment = {
      segmentId: id,
      thinking: "",
      tools: [],
      subagents: [],
    }
    byId.set(id, created)
    ordered.push(created)
    return created
  }
  for (const step of steps) {
    const segment = segmentFor(step.segmentId)
    if (step.kind === "thinking") {
      segment.thinking += step.text
    } else if (step.kind === "tool") {
      segment.tools.push(step.tool)
    } else if (step.kind === "subagent") {
      segment.subagents.push(step.subagent)
    }
    // text 步骤只标记该段存在；正文从 messagesById 取。
  }
  return ordered
}
