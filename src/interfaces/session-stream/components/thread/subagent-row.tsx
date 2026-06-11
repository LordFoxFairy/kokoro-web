import type { SessionSubagent } from "@/application/session-stream/reducer"

import { RobotIcon } from "../icons"
import { MarkdownMessage } from "./markdown-message"
import { RunState } from "./run-state"

const SOURCE_LABEL: Record<SessionSubagent["source"], string> = {
  "built-in": "内置",
  "config-custom": "配置自定义",
  "runtime-custom": "运行时自定义",
}

// 子智能体头部：机器人图标 + 名称 + 来源胶囊（短标签）+ 运行态。
// 抽出来让「可展开」与「不可展开」两种形态共用同一行视觉。
function SubagentHead({ subagent }: { subagent: SessionSubagent }) {
  return (
    <>
      <RobotIcon className="kk-subagent__icon" />
      <span className="kk-subagent__text">
        <span className="kk-subagent__name">{subagent.name}</span>
        <span className="kk-subagent__chip">
          {SOURCE_LABEL[subagent.source]} · {subagent.subagentType}
        </span>
      </span>
      <span className="kk-subagent__state" aria-hidden>
        <RunState done={subagent.status === "done"} />
      </span>
    </>
  )
}

// 单个子智能体：有结论（output）时是可展开的嵌套面板（结构对齐 ToolCallRow 的 <details>），
// 结论用 Markdown 完整换行呈现于左侧细线面板；职责描述常驻行内可见；
// 无结论时退化为不可展开的简单行（无死切换）。
export function SubagentRow({ subagent }: { subagent: SessionSubagent }) {
  const running = subagent.status === "running"
  const description = subagent.description ? (
    <p className="kk-subagent__desc">{subagent.description}</p>
  ) : null

  // 落定且无结论 → 简单静态行（无死切换）。运行中即便结论未到，也展开给「运行中…」loading，
  // 而不是塌成空行——让「在干活、结论还没回来」可见。
  if (!subagent.output && !running) {
    return (
      <div
        className={`kk-subagent kk-subagent--${subagent.status}`}
        data-source={subagent.source}
      >
        <div className="kk-subagent__summary kk-subagent__summary--static">
          <SubagentHead subagent={subagent} />
        </div>
        {description}
      </div>
    )
  }

  return (
    <details
      className={`kk-subagent kk-subagent--${subagent.status}`}
      data-source={subagent.source}
      open={running}
    >
      <summary className="kk-subagent__summary">
        <SubagentHead subagent={subagent} />
      </summary>
      <div className="kk-subagent__detail">
        {description}
        <div className="kk-subagent__result">
          {subagent.output ? (
            <MarkdownMessage content={subagent.output} />
          ) : (
            <p className="kk-pending">
              运行中
              <span className="kk-thread__pulse" aria-hidden>
                <span />
                <span />
                <span />
              </span>
            </p>
          )}
        </div>
      </div>
    </details>
  )
}
