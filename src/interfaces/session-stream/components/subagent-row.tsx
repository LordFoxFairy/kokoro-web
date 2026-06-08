import type { SessionSubagent } from "@/application/session-stream-reducer"

import { RobotIcon } from "./icons"
import { RunState } from "./run-state"

// 单个子智能体：机器人图标 + 名称/职责 + 来源/类型 + 运行态。
export function SubagentRow({ subagent }: { subagent: SessionSubagent }) {
  const sourceLabel =
    subagent.source === "built-in"
      ? "内置"
      : subagent.source === "config-custom"
        ? "配置自定义"
        : "运行时自定义"

  return (
    <div className={`kk-subagent kk-subagent--${subagent.status}`}>
      <RobotIcon className="kk-subagent__icon" />
      <span className="kk-subagent__text">
        <span className="kk-subagent__name">{subagent.name}</span>
        <span className="kk-subagent__desc">
          {sourceLabel} · {subagent.subagentType}
        </span>
        {subagent.description ? (
          <span className="kk-subagent__desc">{subagent.description}</span>
        ) : null}
        {subagent.output ? (
          <span className="kk-subagent__desc">{subagent.output}</span>
        ) : null}
      </span>
      <span className="kk-subagent__state" aria-hidden>
        <RunState done={subagent.status === "done"} />
      </span>
    </div>
  )
}
