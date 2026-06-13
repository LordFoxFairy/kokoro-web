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

// 成形态的盒内内容：就近的「正在…」线索 + 脉冲点。盒由 .kk-turn__answer 统一提供
// （与答案气泡同底色/圆角/内距），故首 token 到达时是盒内内容替换，而非整盒跳换。
// 重连续传时换成「重连中…」，盒上的 data-anchor=reconnecting 让 CSS 给独立、可辨识的样式。
function FormingContent({
  label,
  reconnecting,
}: {
  label: string
  reconnecting: boolean
}) {
  return (
    <span className="kk-turn__forming">
      <span className="kk-forming__label">
        {reconnecting ? "重连中…" : label}
      </span>
      <span className="kk-thread__pulse" aria-hidden>
        <span />
        <span />
        <span />
      </span>
    </span>
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
  const tailMessage = tailId ? messagesById[tailId] : undefined
  const tailHasText = Boolean(tailMessage) && (tailMessage?.content.length ?? 0) > 0
  const formingLabel = mode === "fast" ? "正在整理回答" : "正在思考"
  // 提交后首个 step/token 未到：这一轮还没有任何 segment，但仍在途——给一个成形脚手架
  // （头像已 live + 单条「正在…」），绝不让在途轮塌成空帧。落定/非流式则不渲染脚手架。
  const showScaffold = isLive && segments.length === 0
  // B1 重连可读：尾段已有正文时（streaming 盒，无 forming 盒承载「重连中…」），用 turn 级状态条补出
  // 重连信号——否则刷新回半截 run 只剩头像呼吸、看不出在重连还是卡死。无正文时仍由成形盒显示，互斥不重复。
  const showReconnectStrip = reconnecting && tailHasText

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
        {showReconnectStrip ? (
          <div className="kk-turn__reconnect" data-anchor="reconnecting">
            重连中…
            {/* 脉冲三点：与无正文路径的成形盒动态线索一致，让「正在重连」可读。 */}
            <span className="kk-thread__pulse" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </div>
        ) : null}
        {showScaffold ? (
          <div className="kk-turn__segment">
            <div
              className="kk-msg__bubble kk-turn__answer"
              data-state="forming"
              data-anchor={reconnecting ? "reconnecting" : undefined}
            >
              <FormingContent label={formingLabel} reconnecting={reconnecting} />
            </div>
          </div>
        ) : null}
        {segments.map((segment) => {
          const message = messagesById[segment.segmentId]
          const hasText = Boolean(message) && (message?.content.length ?? 0) > 0
          const liveSegment = isLive && segment.segmentId === tailId
          const showCaret = liveSegment && hasText
          // B2：尾段正文未到（过程先到）或 message 已建但 content 仍空，都回落成形态
          //（同一气泡盒先放「正在…」），消除空白带边框横条的空窗；过程仍挂在下面。
          const forming = liveSegment && !hasText
          const hasProcess =
            segment.thinking.length > 0 ||
            segment.tools.length > 0 ||
            segment.subagents.length > 0
          // 既无气泡又无过程的空段不渲染：避免落定空正文段留一个占位 segment（多段时多撑一个 gap 槽）。
          if (!hasText && !forming && !hasProcess) {
            return null
          }
          return (
            <div className="kk-turn__segment" key={segment.segmentId}>
              {/* 段内贯穿 forming→streaming→settled 三态：复用同一 .kk-turn__answer 元素、同一盒模型，
                  data-state 只切换盒内内容（成形线索 ↔ 正文），首 token 不跳换整盒。
                  注：scaffold（零 segment）→ 首段是跨分支 remount（窄路径，仅同尺寸盒一次 opacity 重淡入，无布局跳动）。 */}
              {hasText || forming ? (
                <div
                  className="kk-msg__bubble kk-turn__answer"
                  data-state={
                    hasText ? (liveSegment ? "streaming" : "settled") : "forming"
                  }
                  data-anchor={
                    forming && reconnecting ? "reconnecting" : undefined
                  }
                >
                  {hasText ? (
                    <>
                      <MarkdownMessage content={message?.content ?? ""} />
                      {/* 正在出字的就近线索：紧跟正文的内联闪烁光标，对读屏隐藏；落定即消失。 */}
                      {showCaret ? <span className="kk-caret" aria-hidden /> : null}
                    </>
                  ) : (
                    <FormingContent
                      label={formingLabel}
                      reconnecting={reconnecting}
                    />
                  )}
                </div>
              ) : null}
              <SegmentProcess
                segmentId={segment.segmentId}
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
