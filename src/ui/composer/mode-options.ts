import { createElement } from "react"

import type { AgentMode } from "@/core/conversations"
import type { MachinePhase } from "@/engine/machine"
import { SparkIcon } from "@/ui/icons/thread"
import { ZapIcon } from "@/ui/icons/composer"

import type { MenuOption } from "./composer-menu"
import styles from "./composer.module.css"

// 模式：Fast（闪电·更快）/ Thinking（火花·更深思考）下拉单选；纯 UI 偏好，不上 wire。
export const MODE_OPTIONS: MenuOption[] = [
  {
    key: "fast",
    label: "Fast",
    hint: "更快回应",
    icon: createElement(ZapIcon, { className: styles.modeGlyph }),
  },
  {
    key: "thinking",
    label: "Thinking",
    hint: "更深的思考",
    icon: createElement(SparkIcon, { className: styles.modeGlyph }),
  },
]

export const MODE_LABEL: Record<AgentMode, string> = {
  fast: "Fast",
  thinking: "Thinking",
}

// 菜单回调的 key 是 string，按 MODE_LABEL 键集收窄，非法 key 不再被强断言为枚举。
export const isAgentMode = (value: string): value is AgentMode =>
  Object.hasOwn(MODE_LABEL, value)

// —— 模式呈现文案：由状态机相位派生（状态层零文案，人话只活在这里）。 ——

export type PresentationPhase = MachinePhase | "failed"

export type ModePresentation = {
  transportLabel: string
  modeHint: string
}

const MODE_HINTS: Record<
  AgentMode,
  {
    idle: string
    connecting: string
    live: string
    settled: string
    failed: string
  }
> = {
  fast: {
    idle: "可直接给你一个结论",
    connecting: "正在快速整理这轮问题",
    live: "正在快速整理这轮问题",
    settled: "已直接给出这轮结论",
    failed: "这轮快速回应没能完成，请再试一次",
  },
  thinking: {
    idle: "会先整理步骤，再给你答案",
    connecting: "正在分步整理这轮思路",
    live: "正在分步整理这轮思路",
    settled: "已按步骤完成这轮思考",
    failed: "这轮分步思考没能完成，请再试一次",
  },
}

export function modePresentation(
  mode: AgentMode,
  phase: PresentationPhase,
  hasMessages: boolean,
): ModePresentation {
  const modeLabel = MODE_LABEL[mode]
  const hints = MODE_HINTS[mode]

  switch (phase) {
    case "failed":
    case "error":
      return { transportLabel: `${modeLabel} · 这轮未完成`, modeHint: hints.failed }
    case "idle":
      return hasMessages
        ? { transportLabel: `${modeLabel} · 已准备继续`, modeHint: hints.settled }
        : { transportLabel: `${modeLabel} · 等你发出首条消息`, modeHint: hints.idle }
    case "submitting":
      return { transportLabel: `${modeLabel} · 正在开始这轮回复`, modeHint: hints.connecting }
    case "reattaching":
      return { transportLabel: `${modeLabel} · 正在重连这一轮`, modeHint: hints.live }
    case "streaming":
    case "awaiting-hitl":
      return { transportLabel: `${modeLabel} · 实时会话已连接`, modeHint: hints.live }
    default: {
      const _exhaustive: never = phase
      return _exhaustive
    }
  }
}
