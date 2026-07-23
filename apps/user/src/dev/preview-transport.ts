// 显式开发模式假流：与 SessionClient 同接口，只经 env 开关注入，永不作运行时兜底。

import { parseSessionEvent, type SessionEvent } from "@/contract/session-events"
import type {
  EventStreamHandle,
  OpenEventsArgs,
  SessionClient,
} from "@/engine/client"

// 仅当显式设置 NEXT_PUBLIC_SESSION_PREVIEW=1 时提供假流客户端；否则返回 null（走真实链路）。
// 单例缓存：清单客户端与引擎客户端共享同一份内存会话（否则各持一份 Map，侧栏永远看不到已开会话）。
let previewSingleton: SessionClient | null = null
export function previewClientFromEnv(): SessionClient | null {
  if (process.env.NEXT_PUBLIC_SESSION_PREVIEW !== "1") {
    return null
  }
  if (!previewSingleton) {
    previewSingleton = createPreviewClient()
  }
  return previewSingleton
}

type PreviewSession = {
  seq: number
  started: boolean
  queued: SessionEvent[]
  subscriber: OpenEventsArgs["onEvent"] | null
  // 清单展示用：首条消息内容充当标题 + 最近活动时间（切走后会话仍留在侧栏，供 HITL 徽标走查）。
  title: string
  updatedAt: string
}

export function createPreviewClient(options?: { stepMs?: number }): SessionClient {
  const stepMs = options?.stepMs ?? 40
  const sessions = new Map<string, PreviewSession>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let runCounter = 0

  const sessionFor = (sessionId: string): PreviewSession => {
    const existing = sessions.get(sessionId)
    if (existing) {
      return existing
    }
    const created: PreviewSession = {
      seq: 0,
      started: false,
      queued: [],
      subscriber: null,
      title: "",
      updatedAt: new Date().toISOString(),
    }
    sessions.set(sessionId, created)
    return created
  }

  const drain = (session: PreviewSession): void => {
    if (!session.subscriber || session.queued.length === 0) {
      return
    }
    const event = session.queued.shift()
    if (event) {
      session.subscriber(event)
    }
    const timer = setTimeout(() => {
      timers.delete(timer)
      drain(session)
    }, stepMs)
    timers.add(timer)
  }

  const enqueueRun = (sessionId: string, runId: string, content: string): void => {
    const session = sessionFor(sessionId)
    let index = 0
    const envelope = (kind: SessionEvent["kind"], payload: unknown): SessionEvent => {
      session.seq += 1
      index += 1
      // 假流同样过契约 parse：既保证 preview 与真实 wire 同形，也免去任何类型断言。
      return parseSessionEvent({
        event_id: `${runId}:${index}`,
        seq: session.seq,
        session_id: sessionId,
        run_id: runId,
        timestamp: new Date().toISOString(),
        kind,
        payload,
      })
    }
    const segmentId = `${runId}:seg_1`
    // 记账清单元数据：首条消息内容作标题，每轮刷新活动时间。
    if (session.title === "") {
      session.title = content
    }
    session.updatedAt = new Date().toISOString()
    if (!session.started) {
      // 与 session 合成语义对齐：首个 run 携带 session.created（sessions 集合元数据）。
      session.started = true
      session.queued.push(envelope("session.created", { title: content, owner_id: "local-user" }))
    }
    // 预览待批态演练：消息以 `!hitl` 起头则合成 tool.awaiting_approval 并停在待批（不发 run.completed），
    // 供 HITL-NOTIFY 跨会话徽标/通知人工走查。仅 dev 假流内可达，不影响真实链路。
    if (content.trim().startsWith("!hitl")) {
      const toolId = `${runId}:tool_1`
      const args = { command: "rm -rf /tmp/preview-demo" }
      session.queued.push(
        envelope("run.created", { run_id: runId }),
        envelope("thinking.delta", { segment_id: segmentId, delta: "Preparing a tool call." }),
        envelope("tool.invoked", { segment_id: segmentId, tool_id: toolId, name: "shell", args }),
        envelope("tool.awaiting_approval", {
          segment_id: segmentId,
          tool_id: toolId,
          name: "shell",
          args,
          description: "Preview: a tool call awaiting your approval.",
          allowed_decisions: ["approve", "reject"],
          kind: "tool_approval",
          editable: false,
          pending_tool_ids: [toolId],
        }),
      )
      drain(session)
      return
    }
    // 预览失败态演练：消息以 `!fail:<code>` 起头则合成对应 run.failed，供 ERROR-UX 卡片人工走查。
    // 仅 dev 假流内可达（NEXT_PUBLIC_SESSION_PREVIEW=1），不影响真实链路。
    const failMatch = /^!fail:([a-z_]+)/.exec(content.trim())
    if (failMatch) {
      const code = failMatch[1]
      session.queued.push(
        envelope("run.created", { run_id: runId }),
        envelope("thinking.delta", { segment_id: segmentId, delta: "Sketching a preview reply." }),
        envelope("run.failed", {
          code,
          error_kind: "PreviewSyntheticError",
          message: `Synthetic failure for preview: ${code}\n  at previewTransport.enqueueRun (dev harness)`,
        }),
      )
      drain(session)
      return
    }
    session.queued.push(
      envelope("run.created", { run_id: runId }),
      envelope("thinking.delta", { segment_id: segmentId, delta: "Sketching a preview reply." }),
      envelope("message.delta", { segment_id: segmentId, delta: "Preview mode: " }),
      envelope("message.delta", { segment_id: segmentId, delta: `echoing "${content}".` }),
      envelope("message.completed", {
        segment_id: segmentId,
        content: `Preview mode: echoing "${content}".`,
      }),
      envelope("run.completed", { status: "completed" }),
    )
    drain(session)
  }

  return {
    // 假流会话只活在内存：清单来自本次会话内已开跑的会话（切走后仍留侧栏，供 HITL 徽标跨会话走查）。
    listSessions: () =>
      Promise.resolve({
        sessions: [...sessions.entries()]
          .filter(([, s]) => s.started)
          .map(([id, s]) => ({ session_id: id, title: s.title || id, updated_at: s.updatedAt }))
          .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
      }),

    // 预览档无 platform 模型源：候选恒为空（输入框据此隐藏模型选择器）。
    listModels: () => Promise.resolve({ models: [] }),

    // 预览档无 namespace profile 源：agent 候选恒为空（输入框据此隐藏 agent 选择器）。
    listAgents: () => Promise.resolve({ agents: [] }),

    // 预览档无持久成果：作品库恒空；分享返回内存假 id（公共页在真 BFF 档才可达）。
    listArtifacts: () => Promise.resolve({ artifacts: [] }),
    createShare: () => Promise.resolve({ share_id: "shr_preview_0000000000000000000000000000" }),
    revokeShare: () => Promise.resolve({ ok: true }),

    createMessage: (sessionId, body) => {
      runCounter += 1
      const runId = `run_preview_${runCounter}`
      enqueueRun(sessionId, runId, body.content)
      return Promise.resolve({
        run_id: runId,
        user_message_id: `${runId}:user`,
        assistant_message_id: `${runId}:assistant`,
      })
    },

    // 假流会话只活在内存队列里：snapshot 语义上恒为「服务端无此会话」。
    fetchSnapshot: () => Promise.resolve(null),

    sendControl: () => Promise.resolve({ ok: true }),
    deleteSession: () => Promise.resolve({ status: "deleted" }),
    renameSession: () => Promise.resolve({ ok: true as const }),

    openEvents: ({ sessionId, onEvent }): EventStreamHandle => {
      const session = sessionFor(sessionId)
      session.subscriber = onEvent
      drain(session)
      return {
        close: () => {
          if (session.subscriber === onEvent) {
            session.subscriber = null
          }
        },
      }
    },
  }
}
