import { createElement } from "react"

import type { AgentMode } from "@/application/conversation-store"

import type { PermissionMode } from "@/application/session-stream/transport"
import type { MenuOption } from "./composer-menu"
import { SparkIcon, ZapIcon } from "../icons"

// 模式：Fast（闪电·更快）/ Thinking（火花·更深思考）下拉单选。接入 run 的 execution_style 后生效。
export const MODE_OPTIONS: MenuOption[] = [
  {
    key: "fast",
    label: "Fast",
    hint: "更快回应",
    icon: createElement(ZapIcon, { className: "kk-composer__mode-glyph" }),
  },
  {
    key: "thinking",
    label: "Thinking",
    hint: "更深的思考",
    icon: createElement(SparkIcon, { className: "kk-composer__mode-glyph" }),
  },
]

export const MODE_LABEL: Record<AgentMode, string> = {
  fast: "Fast",
  thinking: "Thinking",
}

// 菜单回调的 key 是 string，按 MODE_LABEL 键集收窄，非法 key 不再被强断言为枚举。
export const isAgentMode = (value: string): value is AgentMode =>
  Object.hasOwn(MODE_LABEL, value)

// 权限档位（会话级）：auto 全放行 / default 拦外部副作用工具，命中即暂停等你批准。
export const PERMISSION_OPTIONS: MenuOption[] = [
  { key: "auto", label: "Auto", hint: "全自动，放行所有工具" },
  { key: "default", label: "Default", hint: "拦外部副作用工具" },
]

export const PERMISSION_LABEL: Record<PermissionMode, string> = {
  auto: "Auto",
  default: "Default",
}

// 同上，按 PERMISSION_LABEL 键集收窄菜单回调的 string key。
export const isPermissionMode = (value: string): value is PermissionMode =>
  Object.hasOwn(PERMISSION_LABEL, value)
