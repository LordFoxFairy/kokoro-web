// 引擎测试替身：内存 SessionClient / PersistedStore，行为可编程、调用可断言。

import type {
  RunControlBody,
  SessionSnapshot,
  MessageCreateParams,
  MessageCreateReceipt,
} from "@/contract/http"
import type { SessionEvent } from "@/contract/session-events"
import type { OpenEventsArgs, SessionClient, SessionClientError } from "@/engine/client"
import type { PersistedStore } from "@/lib/persisted-store"

export type FakeStream = {
  sessionId: string
  lastEventId: number | undefined
  closed: boolean
  emit: (events: SessionEvent[]) => void
  fail: (error: SessionClientError) => void
}

export type FakeClient = SessionClient & {
  createCalls: { sessionId: string; body: MessageCreateParams }[]
  controlCalls: { sessionId: string; runId: string; body: RunControlBody }[]
  snapshotCalls: string[]
  deleteCalls: string[]
  renameCalls: { sessionId: string; title: string }[]
  // 默认成功 {ok:true}；测试可重写为 reject 以驱动失败回滚路径。
  nextRename: (sessionId: string, title: string) => Promise<{ ok: true }>
  streams: FakeStream[]
  nextCreate: (sessionId: string, body: MessageCreateParams) => Promise<MessageCreateReceipt>
  nextControl: () => Promise<{ ok: true }>
  // 默认 null（服务端无此会话）；测试可按会话编程 snapshot。
  nextSnapshot: (sessionId: string) => Promise<SessionSnapshot | null>
  lastStream: () => FakeStream
}

export function makeReceipt(runId: string): MessageCreateReceipt {
  return {
    run_id: runId,
    user_message_id: `${runId}:user`,
    assistant_message_id: `${runId}:assistant`,
  }
}

export function createFakeClient(): FakeClient {
  let runCounter = 0
  const client: FakeClient = {
    createCalls: [],
    controlCalls: [],
    snapshotCalls: [],
    streams: [],
    nextCreate: () => {
      runCounter += 1
      return Promise.resolve(makeReceipt(`run_${runCounter}`))
    },
    nextControl: () => Promise.resolve({ ok: true }),
    nextSnapshot: () => Promise.resolve(null),
    lastStream: () => {
      const stream = client.streams.at(-1)
      if (!stream) {
        throw new Error("no stream opened")
      }
      return stream
    },
    listSessions: () => Promise.resolve({ sessions: [] }),
    listModels: () => Promise.resolve({ models: [] }),
    listAgents: () => Promise.resolve({ agents: [] }),
    listArtifacts: () => Promise.resolve({ artifacts: [] }),
    createShare: () => Promise.resolve({ share_id: "shr_fake000000000000000000000000000" }),
    revokeShare: () => Promise.resolve({ ok: true as const }),
    createMessage: (sessionId, body) => {
      client.createCalls.push({ sessionId, body })
      return client.nextCreate(sessionId, body)
    },
    fetchSnapshot: (sessionId) => {
      client.snapshotCalls.push(sessionId)
      return client.nextSnapshot(sessionId)
    },
    deleteCalls: [] as string[],
    deleteSession: (sessionId: string) => {
      client.deleteCalls.push(sessionId)
      return Promise.resolve({ status: "deleted" })
    },
    renameCalls: [] as { sessionId: string; title: string }[],
    nextRename: () => Promise.resolve({ ok: true as const }),
    renameSession: (sessionId: string, title: string) => {
      client.renameCalls.push({ sessionId, title })
      return client.nextRename(sessionId, title)
    },
    sendControl: (sessionId, runId, body) => {
      client.controlCalls.push({ sessionId, runId, body })
      return client.nextControl()
    },
    openEvents: (args: OpenEventsArgs) => {
      const stream: FakeStream = {
        sessionId: args.sessionId,
        lastEventId: args.lastEventId,
        closed: false,
        emit: (events) => {
          for (const event of events) {
            args.onEvent(event)
          }
        },
        fail: (error) => {
          args.onStreamError(error)
        },
      }
      client.streams.push(stream)
      return {
        close: () => {
          stream.closed = true
        },
      }
    },
  }
  return client
}

export function createMemoryStorage<T>(initial: T | null = null): PersistedStore<T> & {
  writes: T[]
} {
  let value = initial
  const writes: T[] = []
  const listeners = new Set<() => void>()
  return {
    writes,
    read: () => value,
    write: (next) => {
      value = next
      writes.push(next)
      for (const listener of listeners) {
        listener()
      }
    },
    subscribe: (onChange) => {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
  }
}

// 引擎的批量折叠走微任务：连排空两轮微任务 + 一轮宏任务，覆盖 promise 链与 flush。
export async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}
