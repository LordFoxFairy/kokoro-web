import type { AgentMode } from "@/application/conversation-store"
import type {
  SessionMessage,
  SessionStep,
  SessionSubagent,
  SessionToolCall,
} from "@/application/session-stream/reducer"

import { RobotIcon } from "../icons"
import { MarkdownMessage } from "./markdown-message"
import { SegmentProcess } from "./segment-process"

type AssistantTurnProps = {
  // 这一轮（一个 runId）按 seq 排好的有序步骤：思考/工具/子智能体/文本交错。
  steps: SessionStep[]
  // 文本步骤按 segmentId 取这一段正文；过程先到、正文未到时该段可能暂缺。
  messagesById: Record<string, SessionMessage>
  // 这一轮是否仍在流式：驱动「正在出字」光标、过程默认展开、动态头像。
  isLive: boolean
  // 重连续传态：在途轮的 live 锚点改为「重连中…」，区别于普通「正在思考…」。
  reconnecting?: boolean
  // 本会话模式：透传给过程块作密度 / 文案差异钩子。
  mode?: AgentMode
}

type Segment = {
  segmentId: string
  thinking: string
  tools: SessionToolCall[]
  subagents: SessionSubagent[]
}

// 按 segmentId 把有序步骤分段，保持「首次出现」顺序（即真实发生时序）；
// 每段聚合它自己的思考/工具/子智能体。工具属于它后面那段文本（由 segment_id 归属保证），
// 因此每段的过程正好是「催生这段答案」的那批过程。
function groupSegments(steps: SessionStep[]): Segment[] {
  const order: string[] = []
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
    order.push(id)
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
  return order.map((id) => byId.get(id) as Segment)
}

// 成形占位气泡：过程已到、正文未到（或提交后首 token 未到）时的就近「正在…」线索。
// 重连续传时换成「重连中…」并打 data-anchor=reconnecting，让 CSS 给它独立、可辨识的样式。
function FormingBubble({
  label,
  reconnecting,
}: {
  label: string
  reconnecting: boolean
}) {
  return (
    <div
      className="kk-msg__bubble kk-turn__answer kk-msg__bubble--forming"
      data-anchor={reconnecting ? "reconnecting" : undefined}
    >
      <span className="kk-forming__label">
        {reconnecting ? "重连中…" : label}
      </span>
      <span className="kk-thread__pulse" aria-hidden>
        <span />
        <span />
        <span />
      </span>
    </div>
  )
}

// 助手一轮 = 一个🤖头像 + 一条竖脊。脊上按段堆叠，每段：
//   答案气泡在【上】（最醒目）＋ 它自己的过程挂在气泡【下面】（思考/该段工具/子智能体，
//   收成更轻的可折叠次级块）。多段就是「气泡+过程」依次堆叠，共用一个头像。
// 只有整轮的尾段在流式时带光标 / 动态头像（唯一 live 锚点）。
export function AssistantTurn({
  steps,
  messagesById,
  isLive,
  reconnecting = false,
  mode,
}: AssistantTurnProps) {
  const segments = groupSegments(steps)
  const tailId =
    segments.length > 0 ? segments[segments.length - 1]?.segmentId : undefined
  const formingLabel = mode === "fast" ? "正在整理回答" : "正在思考"
  // 提交后首个 step/token 未到：这一轮还没有任何 segment，但仍在途——给一个成形脚手架
  // （头像已 live + 单条「正在…」），绝不让在途轮塌成空帧。落定/非流式则不渲染脚手架。
  const showScaffold = isLive && segments.length === 0

  return (
    <article
      className="kk-turn kk-turn--assistant kk-msg kk-msg--assistant"
      aria-atomic={isLive ? true : undefined}
    >
      <div
        className={`kk-turn__avatar kk-turn__avatar--bot kk-msg__avatar kk-msg__avatar--bot${isLive ? " kk-msg__avatar--live" : ""}`}
        aria-hidden
      >
        <RobotIcon />
      </div>
      <div className="kk-turn__spine">
        {showScaffold ? (
          <div className="kk-turn__segment">
            <FormingBubble label={formingLabel} reconnecting={reconnecting} />
          </div>
        ) : null}
        {segments.map((segment) => {
          const message = messagesById[segment.segmentId]
          const liveSegment = isLive && segment.segmentId === tailId
          const showCaret =
            liveSegment && Boolean(message) && (message?.content.length ?? 0) > 0
          // 尾段正文未到（过程先到）：气泡位给一个「正在…」成形占位，过程仍挂在下面。
          const forming = liveSegment && !message
          return (
            <div className="kk-turn__segment" key={segment.segmentId}>
              {message ? (
                <div className="kk-msg__bubble kk-turn__answer">
                  <MarkdownMessage content={message.content} />
                  {/* 正在出字的就近线索：紧跟正文的内联闪烁光标，对读屏隐藏；落定即消失。 */}
                  {showCaret ? <span className="kk-caret" aria-hidden /> : null}
                </div>
              ) : forming ? (
                <FormingBubble label={formingLabel} reconnecting={reconnecting} />
              ) : null}
              <SegmentProcess
                thinking={segment.thinking}
                tools={segment.tools}
                subagents={segment.subagents}
                live={liveSegment}
                mode={mode}
              />
            </div>
          )
        })}
      </div>
    </article>
  )
}
