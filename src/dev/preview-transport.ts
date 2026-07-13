// 显式开发模式假流：与 SessionClient 同接口，只经 env 开关注入，永不作运行时兜底。

import { parseSessionEvent, type SessionEvent } from "@/contract/session-events"
import type {
  EventStreamHandle,
  OpenEventsArgs,
  SessionClient,
} from "@/engine/client"

// 仅当显式设置 NEXT_PUBLIC_SESSION_PREVIEW=1 时提供假流客户端；否则返回 null（走真实链路）。
export function previewClientFromEnv(): SessionClient | null {
  return process.env.NEXT_PUBLIC_SESSION_PREVIEW === "1" ? createPreviewClient() : null
}

type PreviewSession = {
  seq: number
  started: boolean
  queued: SessionEvent[]
  subscriber: OpenEventsArgs["onEvent"] | null
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
    const created: PreviewSession = { seq: 0, started: false, queued: [], subscriber: null }
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
    if (!session.started) {
      // 与 session 合成语义对齐：首个 run 携带 session.created（sessions 集合元数据）。
      session.started = true
      session.queued.push(envelope("session.created", { title: content, owner_id: "local-user" }))
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
    // 假流会话只活在内存：清单恒为空（会话列表服务端化在真 BFF 档才有内容）。
    listSessions: () => Promise.resolve({ sessions: [] }),

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
