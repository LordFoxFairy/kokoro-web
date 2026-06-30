import type { SessionStreamEvent } from "@/domain/session-stream-event"
import { toSessionStreamEvent } from "@/infrastructure/transport-event-mapper"
import {
  parseTransportEvent,
  transportEventNames,
} from "@/infrastructure/transport-event-schema"

import {
  applySessionEvent,
  createSessionStreamState,
  markToolRejected,
  type SessionStreamState,
} from "./reducer"

// transportEventNames（从契约生成）是 live EventSource 注册的具名监听全集：
// 漏一个 kind 就会在实时流里被静默丢弃（SSE 用具名事件）。run.created 由
// toSessionStreamEvent 映射为 null（解析但不投影）。

export type SessionStreamSnapshot = SessionStreamState

export type LiveSessionHandle = {
  close: () => void
  // 本句柄正在跟踪的 run：onLive 据此把在途 runId 持久化，刷新后 reattach 才能锚定本轮终态。
  runId?: string
  // HITL：用户拒绝时本地把该 run 指定待批工具置 rejected，落进流的权威 state——否则后续
  // tool.returned（拒绝回流 is_error=false）会把它翻成绿勾 done（reducer 保留 rejected）。
  // toolIds 支持同帧部分审批：只置被拒的工具，批准的不动。真实链路都实现；测试替身可省。
  markToolRejected?: (runId: string, toolIds: readonly string[]) => void
}

// HITL 决策（出站到 session control 端点；session 注入 run_id 后转发 agent run.resume）。
// approve/reject 是工具执行门；respond 是 ask_user_question 这类人工输入工具的返回内容。
export type ResumeDecisionInput =
  | { type: "approve"; tool_id: string }
  | { type: "reject"; tool_id: string; message: string }
  | { type: "respond"; tool_id: string; message: string }

// control 请求体：放弃整个 run，或一次性携同帧全部待批工具的决策（agent 按 tool_id 一一对齐）。
export type RunControlBody =
  | { kind: "run.cancel" }
  | { kind: "run.resume"; decisions: ResumeDecisionInput[] }

// 权限档位（会话级）：auto 全放行 / default 拦外部副作用工具走交互审批。
export type PermissionMode = "auto" | "default"

export type ConsumeLiveSessionInput = {
  input: string
  baseUrl?: string
  sessionId?: string
  executionStyle?: "fast" | "thinking"
  permissionMode?: PermissionMode
  idempotencyKey?: string
  // 持久会话线：让本轮 run 的 assistant 事件折在已有 thread 之上，而不是每轮清零。
  initialState?: SessionStreamState
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: () => void
  onError?: (event: Event) => void
}

export type ReattachLiveSessionInput = {
  sessionId: string
  baseUrl?: string
  // 续传锚定的在途 run：刷新前持久化的 pendingRunId，使 reattach 只在本轮终态收束，
  // 不被 replay 流里历史 run 的终态提前关闭（与 consumeLiveSession 同一道防线）。
  runId?: string
  initialState: SessionStreamState
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: () => void
  onError?: (event: Event) => void
}

const demoSessionId = "ses_01"

export function resolveSessionBaseUrl() {
  if (process.env.NEXT_PUBLIC_KOKORO_SESSION_BASE_URL) {
    return process.env.NEXT_PUBLIC_KOKORO_SESSION_BASE_URL
  }

  if (typeof window !== "undefined") {
    const sessionHost = window.location.hostname === "localhost"
      ? "localhost"
      : "127.0.0.1"

    return `http://${sessionHost}:3001`
  }

  return "http://127.0.0.1:3001"
}

// HITL：放弃整个 run，或恢复暂停并携同帧全部工具的审批决策 → session control 端点（POST JSON body，
// 因决策数组含 edit 的 edited_action 可超 query 串上限）。
export async function sendRunControl(input: {
  sessionId: string
  runId: string
  body: RunControlBody
  baseUrl?: string
}): Promise<void> {
  const requestUrl = new URL(
    `/sessions/${input.sessionId}/runs/${input.runId}/control`,
    input.baseUrl ?? resolveSessionBaseUrl(),
  )
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body),
  })
  if (!response.ok) {
    throw new Error(`control request failed: ${response.status}`)
  }
}

// 严格解析 SSE 载荷；任何畸形/未知事件被拒绝且不允许中断整条流。
function decodeStreamMessage(event: Event): SessionStreamEvent | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    return null
  }

  try {
    const raw: unknown = JSON.parse(event.data)
    return toSessionStreamEvent(parseTransportEvent(raw))
  } catch {
    return null
  }
}

type OpenSessionStreamArgs = {
  sessionId: string
  baseUrl: string
  // 本轮关注的 run：SSE 从流首重放会带上历史 run 的终态，只有匹配本轮 runId 的终态才收束；
  // 不传（如 reattach 无从得知在途 runId）则退回「任一终态即收束」的旧行为。
  runId?: string
  initialState: SessionStreamState
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: () => void
  onError?: (event: Event) => void
}

// 打开某 session 的 SSE，把 AGUI 事件折进 reducer；仅本轮 run 的 run.completed/run.failed 关闭流。
// 由 consumeLiveSession（先 POST 再监听）与 reattachLiveSession（仅监听、断后续传）共用。
export function openSessionStream(args: OpenSessionStreamArgs): LiveSessionHandle {
  if (typeof EventSource === "undefined") {
    return { close: () => {}, markToolRejected: () => {} }
  }

  let state = args.initialState
  const streamUrl = new URL(`/sessions/${args.sessionId}/stream`, args.baseUrl)
  const source = new EventSource(streamUrl.toString())

  const close = () => {
    for (const eventName of transportEventNames) {
      source.removeEventListener(eventName, handleEvent)
    }
    source.close()
  }

  const handleEvent: EventListener = (event) => {
    const sessionEvent = decodeStreamMessage(event)

    if (!sessionEvent) {
      return
    }

    state = applySessionEvent(state, sessionEvent)
    args.onState(state)

    if (
      (sessionEvent.kind === "run-completed" ||
        sessionEvent.kind === "run-failed") &&
      // 只在本轮 run 的终态收束；重放到历史 run 的终态时保持监听，等本轮事件到达。
      (args.runId === undefined || sessionEvent.runId === args.runId)
    ) {
      close()
      args.onSettled?.()
    }
  }

  for (const eventName of transportEventNames) {
    source.addEventListener(eventName, handleEvent)
  }

  source.onerror = (event) => {
    // 传输瞬断进入可恢复态：保留 EventSource 让浏览器自动重连，不撕毁状态。
    args.onError?.(event)
  }

  return {
    close,
    runId: args.runId,
    markToolRejected: (runId: string, toolIds: readonly string[]) => {
      state = markToolRejected(state, runId, toolIds)
      args.onState(state)
    },
  }
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function buildMessageRequest(input: ConsumeLiveSessionInput, baseUrl: string) {
  const sessionId = input.sessionId ?? demoSessionId
  const requestUrl = new URL(`/sessions/${sessionId}/messages`, baseUrl)
  const body: Record<string, unknown> = {
    idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
    content: input.input,
    executionStyle: input.executionStyle ?? "fast",
  }
  if (input.permissionMode && input.permissionMode !== "auto") {
    body.permissionMode = input.permissionMode
  }
  return { requestUrl, sessionId, body }
}

// 纯渲染消费者：POST 触发 run，再开 SSE 把 AGUI 事件折进 reducer。
export async function consumeLiveSession(
  input: ConsumeLiveSessionInput,
): Promise<LiveSessionHandle> {
  const baseUrl = input.baseUrl ?? resolveSessionBaseUrl()
  const { requestUrl, sessionId, body } = buildMessageRequest(input, baseUrl)

  const response = await fetch(requestUrl.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`session start failed with status ${response.status}`)
  }

  // 用 POST 回执里的 runId 锚定本轮：SSE 重放历史 run 的终态时不提前收束，避免丢本轮回答。
  // 非 JSON 回执（或缺 runId）退回无 runId 旧行为，绝不因解析失败让整轮回复崩掉。
  let runId: string | undefined
  try {
    const body = (await response.json()) as { runId?: string }
    runId = body?.runId
  } catch {
    runId = undefined
  }

  return openSessionStream({
    sessionId,
    baseUrl,
    runId,
    initialState: input.initialState ?? createSessionStreamState(),
    onState: input.onState,
    onSettled: input.onSettled,
    onError: input.onError,
  })
}

// 中断恢复：不发新 POST，直接重订阅某 session 的 SSE。session 的 replay 从流首回放，
// 刷新/断线后据此把在途 run 的剩余事件续上（已收到的 eventId 由 reducer 去重）。
export function reattachLiveSession(
  input: ReattachLiveSessionInput,
): LiveSessionHandle {
  return openSessionStream({
    sessionId: input.sessionId,
    baseUrl: input.baseUrl ?? resolveSessionBaseUrl(),
    runId: input.runId,
    initialState: input.initialState,
    onState: input.onState,
    onSettled: input.onSettled,
    onError: input.onError,
  })
}
