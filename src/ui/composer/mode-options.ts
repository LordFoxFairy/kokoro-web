import { createElement } from "react"

import type { AgentMode } from "@/core/conversations"
import type { MessageKey } from "@/i18n/messages"
import type { MachinePhase } from "@/engine/machine"
import { SparkIcon } from "@/ui/icons/thread"
import { ZapIcon } from "@/ui/icons/composer"

import type { MenuOption } from "./composer-menu"
import styles from "./composer.module.css"

type Translate = (key: MessageKey, vars?: Readonly<Record<string, string | number>>) => string

// 模式：Fast（闪电·更快）/ Thinking（火花·更深思考）下拉单选；纯 UI 偏好，不上 wire。
// hint 走 i18n key，由消费组件（composer 菜单）在渲染时 t() 解析。
export function modeOptions(t: Translate): MenuOption[] {
  return [
    {
      key: "fast",
      label: "Fast",
      hint: t("mode.hintFast"),
      icon: createElement(ZapIcon, { className: styles.modeGlyph }),
    },
    {
      key: "thinking",
      label: "Thinking",
      hint: t("mode.hintThink"),
      icon: createElement(SparkIcon, { className: styles.modeGlyph }),
    },
  ]
}

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

// 各模式的相位文案 key（idle/busy/settled/failed）。connecting 与 live 共用 busy。
const MODE_HINT_KEYS: Record<
  AgentMode,
  { idle: MessageKey; busy: MessageKey; settled: MessageKey; failed: MessageKey }
> = {
  fast: {
    idle: "mode.fastIdle",
    busy: "mode.fastBusy",
    settled: "mode.fastSettled",
    failed: "mode.fastFailed",
  },
  thinking: {
    idle: "mode.thinkIdle",
    busy: "mode.thinkBusy",
    settled: "mode.thinkSettled",
    failed: "mode.thinkFailed",
  },
}

export function modePresentation(
  t: Translate,
  mode: AgentMode,
  phase: PresentationPhase,
  hasMessages: boolean,
): ModePresentation {
  const modeLabel = MODE_LABEL[mode]
  const hints = MODE_HINT_KEYS[mode]

  switch (phase) {
    case "failed":
    case "error":
      return { transportLabel: t("mode.tFailed", { mode: modeLabel }), modeHint: t(hints.failed) }
    case "idle":
      return hasMessages
        ? { transportLabel: t("mode.tReady", { mode: modeLabel }), modeHint: t(hints.settled) }
        : { transportLabel: t("mode.tAwaitFirst", { mode: modeLabel }), modeHint: t(hints.idle) }
    case "submitting":
      return { transportLabel: t("mode.tStarting", { mode: modeLabel }), modeHint: t(hints.busy) }
    case "reattaching":
      return { transportLabel: t("mode.tReconnecting", { mode: modeLabel }), modeHint: t(hints.busy) }
    case "streaming":
    case "awaiting-hitl":
      return { transportLabel: t("mode.tConnected", { mode: modeLabel }), modeHint: t(hints.busy) }
    default: {
      const _exhaustive: never = phase
      return _exhaustive
    }
  }
}
