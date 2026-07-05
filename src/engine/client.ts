// session HTTP/SSE 客户端：全部入站（含 POST 回执与 snapshot）过 contract Zod；失败以类型化错误上抛，零静默降级。

import { ZodError } from "zod"

import {
  controlPath,
  eventsPath,
  LAST_EVENT_ID_HEADER,
  messagesPath,
  parseSessionSnapshot,
  runControlReceiptSchema,
  snapshotPath,
  startMessageReceiptSchema,
  type RunControlBody,
  type RunControlReceipt,
  type SessionSnapshot,
  type StartMessageBody,
  type StartMessageReceipt,
  deleteSessionReceiptSchema,
  type DeleteSessionReceipt,
} from "@/contract/http"
import { parseSessionEvent, type SessionEvent } from "@/contract/session-events"

export type ClientFailureReason = "network" | "http" | "parse"

export class SessionClientError extends Error {
  readonly reason: ClientFailureReason

  constructor(reason: ClientFailureReason, message: string) {
    super(message)
    this.name = "SessionClientError"
    this.reason = reason
  }
}

export type EventStreamHandle = { close: () => void }

export type OpenEventsArgs = {
  sessionId: string
  // 续流水位（snapshot event_watermark 或已折叠的最大 seq）：作为 Last-Event-ID 请求头上送。
  lastEventId?: number
  onEvent: (event: SessionEvent) => void
  // 入站载荷未过契约或流已不可恢复：交状态机转错误态。
  onStreamError: (error: SessionClientError) => void
}

export type SessionClient = {
  startRun: (sessionId: string, body: StartMessageBody) => Promise<StartMessageReceipt>
  // 服务端不存在该会话（404）返回 null（本地新会话的合法答案）；其余失败照常上抛。
  fetchSnapshot: (sessionId: string) => Promise<SessionSnapshot | null>
  sendControl: (
    sessionId: string,
    runId: string,
    body: RunControlBody,
  ) => Promise<RunControlReceipt>
  // 软删除（technical/16）：服务端打状态位；幂等（不存在/已删除同为 202）。
  deleteSession: (sessionId: string) => Promise<DeleteSessionReceipt>
  openEvents: (args: OpenEventsArgs) => EventStreamHandle
}

// 断流重连间隔：对齐 EventSource 的默认重试节奏，按最后 seq 续连不重放。
const SSE_RETRY_MS = 2_000

function describeUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 失败响应尽力取出契约错误码（如 session_run_active）作为错误消息，供上层识别。
async function httpError(method: string, url: string, response: Response): Promise<SessionClientError> {
  let detail = `${method} ${url} failed with status ${response.status}`
  try {
    const raw: unknown = await response.json()
    if (typeof raw === "object" && raw !== null && "error" in raw && typeof raw.error === "string") {
      detail = raw.error
    }
  } catch {
    // 无 JSON 错误体：保留状态码描述。
  }
  return new SessionClientError("http", detail)
}

async function parseJsonResponse<T>(response: Response, parse: (raw: unknown) => T): Promise<T> {
  let raw: unknown
  try {
    raw = await response.json()
  } catch (error) {
    throw new SessionClientError("parse", describeUnknown(error))
  }
  try {
    return parse(raw)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new SessionClientError("parse", error.message)
    }
    throw error
  }
}

async function postJson<T>(
  url: string,
  body: unknown,
  parse: (raw: unknown) => T,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new SessionClientError("network", describeUnknown(error))
  }
  if (!response.ok) {
    throw await httpError("POST", url, response)
  }
  return parseJsonResponse(response, parse)
}

// SSE 帧增量解析（纯函数）：跨 chunk 累积，按空行切帧，帧内 data 行拼接后回调。
export function createSseFrameParser(onData: (data: string) => void): (chunk: string) => void {
  let buffer = ""
  return (chunk) => {
    buffer += chunk
    let separator = buffer.indexOf("\n\n")
    while (separator >= 0) {
      const frame = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      const data = frame
        .split("\n")
        .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).replace(/^ /, ""))
        .join("\n")
      if (data.length > 0) {
        onData(data)
      }
      separator = buffer.indexOf("\n\n")
    }
  }
}

export function createSessionClient(options: { baseUrl: string }): SessionClient {
  const url = (path: string): string => new URL(path, options.baseUrl).toString()

  return {
    startRun: (sessionId, body) =>
      postJson(url(messagesPath(sessionId)), body, (raw) =>
        startMessageReceiptSchema.parse(raw),
      ),

    fetchSnapshot: async (sessionId) => {
      const target = url(snapshotPath(sessionId))
      let response: Response
      try {
        response = await fetch(target, { cache: "no-store" })
      } catch (error) {
        throw new SessionClientError("network", describeUnknown(error))
      }
      if (response.status === 404) {
        return null
      }
      if (!response.ok) {
        throw await httpError("GET", target, response)
      }
      return parseJsonResponse(response, parseSessionSnapshot)
    },

    sendControl: (sessionId, runId, body) =>
      postJson(url(controlPath(sessionId, runId)), body, (raw) =>
        runControlReceiptSchema.parse(raw),
      ),

    deleteSession: async (sessionId) => {
      const target = url(snapshotPath(sessionId))  // DELETE 与 snapshot 同路径（契约）
      let response: Response
      try {
        response = await fetch(target, { method: "DELETE" })
      } catch (error) {
        throw new SessionClientError("network", describeUnknown(error))
      }
      if (!response.ok) {
        throw await httpError("DELETE", target, response)
      }
      return parseJsonResponse(response, (raw) => deleteSessionReceiptSchema.parse(raw))
    },

    // fetch 流式 SSE（非 EventSource）：首连即可携带 Last-Event-ID 头（契约续流轴 = seq），
    // 断流按最后已见 seq 自动重连；契约拒绝或 HTTP 错误 fail-loud 收口，不静默降级。
    openEvents: ({ sessionId, lastEventId, onEvent, onStreamError }) => {
      const target = url(eventsPath(sessionId))
      const controller = new AbortController()
      let retryTimer: ReturnType<typeof setTimeout> | null = null
      let closed = false
      let cursor = lastEventId

      const fail = (error: SessionClientError): void => {
        if (closed) {
          return
        }
        closed = true
        controller.abort()
        onStreamError(error)
      }

      const scheduleRetry = (): void => {
        if (closed) {
          return
        }
        retryTimer = setTimeout(() => {
          retryTimer = null
          void connect()
        }, SSE_RETRY_MS)
      }

      const parser = createSseFrameParser((data) => {
        let raw: unknown
        try {
          raw = JSON.parse(data)
        } catch (error) {
          fail(new SessionClientError("parse", describeUnknown(error)))
          return
        }
        let event: SessionEvent
        try {
          event = parseSessionEvent(raw)
        } catch {
          fail(new SessionClientError("parse", "SSE payload rejected by contract"))
          return
        }
        cursor = event.seq
        onEvent(event)
      })

      const connect = async (): Promise<void> => {
        const headers: Record<string, string> = { accept: "text/event-stream" }
        if (cursor !== undefined) {
          headers[LAST_EVENT_ID_HEADER] = String(cursor)
        }
        let response: Response
        try {
          response = await fetch(target, {
            headers,
            cache: "no-store",
            signal: controller.signal,
          })
        } catch {
          // 网络失败（含 abort）：close 时静默退出，否则按 cursor 定时重连。
          scheduleRetry()
          return
        }
        if (closed) {
          return
        }
        if (!response.ok || response.body === null) {
          fail(new SessionClientError("http", `GET ${target} failed with status ${response.status}`))
          return
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) {
              break
            }
            parser(decoder.decode(value, { stream: true }))
            if (closed) {
              return
            }
          }
        } catch {
          // 读取中断（网络/abort）：与连接失败同路径处理。
        }
        scheduleRetry()
      }

      void connect()

      return {
        close: () => {
          closed = true
          if (retryTimer !== null) {
            clearTimeout(retryTimer)
            retryTimer = null
          }
          controller.abort()
        },
      }
    },
  }
}
