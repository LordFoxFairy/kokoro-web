import { useId } from "react"

import type { AgentMode } from "@/application/conversation-store"
import type {
  SessionSubagent,
  SessionToolCall,
} from "@/application/session-stream/reducer"
import { setDisclosure } from "@/application/session-stream/process-disclosure"

import { useProcessDisclosure } from "../../hooks/use-process-disclosure"
import { ChevronIcon, SparkIcon } from "../icons"
import { SubagentRow } from "./subagent-row"
import { ToolCallRow } from "./tool-call-row"

type SegmentProcessProps = {
  // 该段全局唯一 id：作为持久化展开意图（manualOpen）的键，跨刷新保留。
  segmentId: string
  // 这一段的过程：思考独白 + 该段用到的工具 + 子智能体。
  thinking: string
  tools: SessionToolCall[]
  subagents: SessionSubagent[]
  // 这一段是否仍在生长（整轮的尾段）：决定默认展开（实时看）与「思考中」脉冲。
  live: boolean
  // 本会话模式：Fast 把「思考」改称「处理」，避免「直接作答」与「思考」自相矛盾。
  mode?: AgentMode
  // HITL：批准/拒绝本轮待批工具（已按 runId 绑定）。
  onToolDecision?: (decision: "approve" | "reject") => void
}

// 落定摘要：「思考过程 · N 工具(K 失败) · M 子智能体」，省略为零的维度。
// 失败数作为「工具」的从属括注（非并列维度），让子集关系一眼可辨、不被误读为相加。
function settledSummary(
  verb: string,
  tools: number,
  subs: number,
  failed: number,
): string {
  const parts = [`${verb}过程`]
  if (tools > 0) {
    parts.push(failed > 0 ? `${tools} 个工具（${failed} 失败）` : `${tools} 个工具`)
  }
  if (subs > 0) parts.push(`${subs} 个子智能体`)
  return parts.join(" · ")
}

// 一段的「过程块」：挂在该段答案气泡【下面】的可折叠次级披露——比气泡更轻（muted）。
// 流式中（尾段）默认展开方便实时看，落定后收成一行摘要，保持对话干净。全空时不渲染。
export function SegmentProcess({
  segmentId,
  thinking,
  tools,
  subagents,
  live,
  mode,
  onToolDecision,
}: SegmentProcessProps) {
  // 默认展开态跟随 live 信号：尾段流式时摊开实时看，落定即收成一行摘要。
  // 一旦用户手动切换（manualOpen 落定），就以用户意图为准、不再随 live 变化对抗用户。
  // manualOpen 持久化在按 segmentId 键的 disclosure store（跨刷新保留），非组件本地 state。
  // 用受控 div+button（非原生 details）以便给展开/收起做高度过渡；状态机不靠 remount。
  const manualOpen = useProcessDisclosure(segmentId)
  // 有工具待批时强制展开（盖过用户手动折叠）：否则批准/拒绝按钮被裁掉、HITL 卡死无入口。
  const hasAwaiting = tools.some((tool) => tool.status === "awaiting")
  const open = hasAwaiting || (manualOpen ?? live)
  const bodyId = useId()

  const hasActivity =
    thinking.length > 0 || tools.length > 0 || subagents.length > 0
  if (!hasActivity) {
    return null
  }

  const verb = mode === "fast" ? "处理" : "思考"
  const failedTools = tools.filter((tool) => tool.status === "error").length
  const summary = live
    ? `${verb}中…`
    : settledSummary(verb, tools.length, subagents.length, failedTools)

  return (
    <div className="kk-process" data-mode={mode} data-open={open}>
      <button
        type="button"
        className="kk-process__summary"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setDisclosure(segmentId, !open)}
      >
        <SparkIcon className="kk-process__spark" />
        {/* key 随 live 翻转：落定时标题 remount，配合 CSS 让新摘要淡入（live↔settled 不硬跳）。 */}
        <span className="kk-process__title" key={live ? "live" : "settled"}>
          {summary}
        </span>
        {live ? (
          <span className="kk-process__live" aria-label={`${verb}中`}>
            <i />
            <i />
            <i />
          </span>
        ) : null}
        <ChevronIcon className="kk-process__chevron" />
      </button>

      {/* 三层：reveal 做 grid 0fr↔1fr 高度过渡；clip 是纯裁剪的 grid 项（收起时把 body 整体裁到 0，
          含其滚动视口）；body 保留自身滚动封顶。少一层 clip 收起就裁不净嵌套滚动容器。 */}
      <div className="kk-process__reveal">
        <div className="kk-process__clip">
          {/* inert（收起时）把内容移出无障碍树 + 不可聚焦，补回原生 details 的隐藏语义；
              它不设 display:none，故 grid 高度过渡仍能动（视觉裁剪由 clip 的 overflow:hidden 负责）。 */}
          <div className="kk-process__body" id={bodyId} inert={!open}>
            {thinking ? <p className="kk-process__thinking">{thinking}</p> : null}

            {tools.length > 0 ? (
              <div className="kk-actgroup" aria-label="工具调用">
                {tools.map((tool) => (
                  <ToolCallRow
                    key={tool.id}
                    tool={tool}
                    onApprove={
                      onToolDecision ? () => onToolDecision("approve") : undefined
                    }
                    onReject={
                      onToolDecision ? () => onToolDecision("reject") : undefined
                    }
                  />
                ))}
              </div>
            ) : null}

            {subagents.length > 0 ? (
              <div className="kk-actgroup" aria-label="子智能体">
                {subagents.map((subagent) => (
                  <SubagentRow key={subagent.id} subagent={subagent} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
