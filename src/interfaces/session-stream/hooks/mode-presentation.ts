import type { AgentMode } from "@/application/conversation-store"
import type { ReplyMode } from "@/application/session-stream/reply"

export type TransportState = "idle" | "connecting" | ReplyMode

export type PresentationTransportState = TransportState | "failed"

export type ModePresentation = {
  transportLabel: string
  modeHint: string
}

const MODE_HINTS: Record<
  AgentMode,
  {
    idle: string
    connecting: string
    preview: string
    live: string
    settled: string
    failed: string
  }
> = {
  fast: {
    idle: "可直接给你一个结论",
    connecting: "正在快速整理这轮问题",
    preview: "本地预览也会直接给你一个结论",
    live: "正在快速整理这轮问题",
    settled: "已直接给出这轮结论",
    failed: "这轮快速回应没能完成，请再试一次",
  },
  thinking: {
    idle: "会先整理步骤，再给你答案",
    connecting: "正在分步整理这轮思路",
    preview: "本地预览也会先整理步骤，再给你答案",
    live: "正在分步整理这轮思路",
    settled: "已按步骤完成这轮思考",
    failed: "这轮分步思考没能完成，请再试一次",
  },
}

export function modePresentation(
  mode: AgentMode,
  transportState: PresentationTransportState,
  isStreaming: boolean,
  hasMessages: boolean,
): ModePresentation {
  const modeLabel = mode === "thinking" ? "Thinking" : "Fast"
  const hints = MODE_HINTS[mode]

  if (transportState === "failed") {
    return {
      transportLabel: `${modeLabel} · 这轮未完成`,
      modeHint: hints.failed,
    }
  }

  if (transportState === "idle") {
    return hasMessages
      ? {
          transportLabel: `${modeLabel} · 已准备继续`,
          modeHint: hints.settled,
        }
      : {
          transportLabel: `${modeLabel} · 等你发出首条消息`,
          modeHint: hints.idle,
        }
  }

  if (transportState === "connecting") {
    return {
      transportLabel: `${modeLabel} · 正在开始这轮回复`,
      modeHint: hints.connecting,
    }
  }

  if (transportState === "preview") {
    return {
      transportLabel: `${modeLabel} · 本地预览`,
      modeHint: isStreaming ? hints.connecting : hints.preview,
    }
  }

  return {
    transportLabel: `${modeLabel} · 实时会话已连接`,
    modeHint: isStreaming ? hints.live : hints.settled,
  }
}
