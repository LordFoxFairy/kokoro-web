import { describe, expect, it } from "vitest"

import type { AgentMode } from "@/application/conversation-store"
import {
  modePresentation,
  type PresentationTransportState,
} from "@/interfaces/session-stream/hooks/mode-presentation"

// 纯展示映射：六态 × Fast/Thinking × 流式与否的文案矩阵，钉死每条分支。
type Row = {
  mode: AgentMode
  transport: PresentationTransportState
  isStreaming: boolean
  hasMessages: boolean
  label: string
  hint: string
}

const ROWS: Row[] = [
  // failed —— 两模式各一条失败文案，与 isStreaming/hasMessages 无关。
  { mode: "fast", transport: "failed", isStreaming: false, hasMessages: true, label: "Fast · 这轮未完成", hint: "这轮快速回应没能完成，请再试一次" },
  { mode: "thinking", transport: "failed", isStreaming: true, hasMessages: false, label: "Thinking · 这轮未完成", hint: "这轮分步思考没能完成，请再试一次" },
  // idle —— 有历史则「已准备继续」，无历史则「等你发出首条消息」。
  { mode: "fast", transport: "idle", isStreaming: false, hasMessages: true, label: "Fast · 已准备继续", hint: "已直接给出这轮结论" },
  { mode: "fast", transport: "idle", isStreaming: false, hasMessages: false, label: "Fast · 等你发出首条消息", hint: "可直接给你一个结论" },
  { mode: "thinking", transport: "idle", isStreaming: false, hasMessages: true, label: "Thinking · 已准备继续", hint: "已按步骤完成这轮思考" },
  { mode: "thinking", transport: "idle", isStreaming: false, hasMessages: false, label: "Thinking · 等你发出首条消息", hint: "会先整理步骤，再给你答案" },
  // connecting —— 与 isStreaming 无关。
  { mode: "fast", transport: "connecting", isStreaming: false, hasMessages: false, label: "Fast · 正在开始这轮回复", hint: "正在快速整理这轮问题" },
  { mode: "thinking", transport: "connecting", isStreaming: true, hasMessages: true, label: "Thinking · 正在开始这轮回复", hint: "正在分步整理这轮思路" },
  // preview —— 标签恒为本地预览，hint 随 isStreaming 在 connecting/preview 间切。
  { mode: "fast", transport: "preview", isStreaming: true, hasMessages: true, label: "Fast · 本地预览", hint: "正在快速整理这轮问题" },
  { mode: "fast", transport: "preview", isStreaming: false, hasMessages: true, label: "Fast · 本地预览", hint: "本地预览也会直接给你一个结论" },
  { mode: "thinking", transport: "preview", isStreaming: false, hasMessages: true, label: "Thinking · 本地预览", hint: "本地预览也会先整理步骤，再给你答案" },
  // live —— 标签恒为实时会话已连接，hint 随 isStreaming 在 live/settled 间切。
  { mode: "fast", transport: "live", isStreaming: true, hasMessages: true, label: "Fast · 实时会话已连接", hint: "正在快速整理这轮问题" },
  { mode: "fast", transport: "live", isStreaming: false, hasMessages: true, label: "Fast · 实时会话已连接", hint: "已直接给出这轮结论" },
  { mode: "thinking", transport: "live", isStreaming: true, hasMessages: true, label: "Thinking · 实时会话已连接", hint: "正在分步整理这轮思路" },
  { mode: "thinking", transport: "live", isStreaming: false, hasMessages: true, label: "Thinking · 实时会话已连接", hint: "已按步骤完成这轮思考" },
]

describe("modePresentation", () => {
  it.each(ROWS)(
    "$mode/$transport streaming=$isStreaming hasMessages=$hasMessages → $label",
    ({ mode, transport, isStreaming, hasMessages, label, hint }) => {
      const result = modePresentation(mode, transport, isStreaming, hasMessages)
      expect(result.transportLabel).toBe(label)
      expect(result.modeHint).toBe(hint)
    },
  )
})
