import type { MessageProcessor } from "@a2ui/web_core/v0_9"
import type { ReactComponentImplementation } from "@a2ui/react/v0_9"

export function resolveSessionBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_KOKORO_SESSION_BASE_URL) {
    return process.env.NEXT_PUBLIC_KOKORO_SESSION_BASE_URL
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname === "localhost" ? "localhost" : "127.0.0.1"
    return `http://${host}:3001`
  }
  return "http://127.0.0.1:3001"
}

// 单条 SSE a2ui.op 载荷 → 喂 processor。畸形行吞掉不崩（纯渲染韧性）。
export function feedA2uiLine(processor: MessageProcessor<ReactComponentImplementation>, data: string): void {
  let op: unknown
  try {
    op = JSON.parse(data)
  } catch {
    return
  }
  if (typeof op !== "object" || op === null || !("version" in op)) {
    return
  }
  try {
    processor.processMessages([op] as never)
  } catch {
    // 单条 op 适配失败不撕毁整条流
  }
}

export type A2uiSessionHandle = { close: () => void }

// POST 触发 run，开 EventSource 订阅 a2ui.op，逐条喂 processor。onOp 回调供 React 重渲染节流。
export async function startA2uiSession(opts: {
  processor: MessageProcessor<ReactComponentImplementation>
  input: string
  sessionId: string
  conversationId?: string
  onOp?: () => void
  baseUrl?: string
}): Promise<A2uiSessionHandle> {
  const baseUrl = opts.baseUrl ?? resolveSessionBaseUrl()
  const conversationId = opts.conversationId ?? opts.sessionId
  const runUrl = new URL(`/sessions/${opts.sessionId}/runs`, baseUrl)
  runUrl.searchParams.set("conversation_id", conversationId)
  runUrl.searchParams.set("input", opts.input)
  runUrl.searchParams.set("execution_style", "thinking")

  const res = await fetch(runUrl.toString(), { method: "POST" })
  if (!res.ok) throw new Error(`session start failed: ${res.status}`)

  if (typeof EventSource === "undefined") return { close: () => {} }
  const streamUrl = new URL(`/sessions/${opts.sessionId}/stream`, baseUrl)
  const source = new EventSource(streamUrl.toString())
  const handler: EventListener = (e) => {
    if (e instanceof MessageEvent) {
      feedA2uiLine(opts.processor, e.data as string)
      opts.onOp?.()
    }
  }
  source.addEventListener("a2ui.op", handler)
  return {
    close: () => {
      source.removeEventListener("a2ui.op", handler)
      source.close()
    },
  }
}
