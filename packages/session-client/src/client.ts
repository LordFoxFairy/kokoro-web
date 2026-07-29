import { ZodError } from "zod"

import {
  LAST_EVENT_ID_HEADER,
  controlPath,
  controlReceiptPath,
  controlReceiptViewSchema,
  eventsPath,
  messageCreateParamsSchema,
  messageCreateReceiptSchema,
  messagesPath,
  parseSessionEvent,
  parseSessionSnapshot,
  runControlBodySchema,
  runControlReceiptSchema,
  snapshotPath,
  type ControlReceiptView,
  type MessageCreateParams,
  type MessageCreateReceipt,
  type RunControlBody,
  type RunControlReceipt,
  type SessionEvent,
  type SessionSnapshot,
} from "./contracts.js"
import {
  createCursorPolicy,
  type CursorPolicy,
  type CursorRecovery,
  type SessionCursor,
} from "./cursor-policy.js"

export type SessionRequest = {
  readonly method: "GET" | "POST"
  readonly path: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly signal?: AbortSignal
}

export type SessionResponse = {
  readonly status: number
  readonly headers: Headers
  readonly body: unknown
}

export type SessionStreamResponse = {
  readonly status: number
  readonly headers: Headers
  readonly body: ReadableStream<Uint8Array> | null
}

/**
 * The app/BFF owns routing and credentials. The brandless client receives only
 * contract-relative paths, so it cannot select a Site or accept a raw Session URL.
 */
export type SessionTransport = {
  readonly request: (request: SessionRequest) => Promise<SessionResponse>
  readonly stream: (request: SessionRequest) => Promise<SessionStreamResponse>
}

export type SessionClientErrorKind =
  | "auth_required"
  | "command_conflict"
  | "contract_incompatible"
  | "http"
  | "network"
  | "protocol"
  | "repair_required"

export class SessionClientError extends Error {
  readonly kind: SessionClientErrorKind
  readonly status?: number
  readonly recovery?: CursorRecovery

  constructor(
    kind: SessionClientErrorKind,
    message: string,
    options: { status?: number; recovery?: CursorRecovery; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "SessionClientError"
    this.kind = kind
    if (options.status !== undefined) this.status = options.status
    if (options.recovery !== undefined) this.recovery = options.recovery
  }
}

export type SessionHydration =
  | {
      readonly kind: "ready"
      readonly snapshot: SessionSnapshot
      readonly cursor: SessionCursor
    }
  | { readonly kind: "not_found" }
  | {
      readonly kind: "repair_required" | "contract_incompatible"
      readonly snapshot: SessionSnapshot
      readonly reason: string
    }

export type SessionConnectionState =
  | { readonly kind: "connecting" | "live" | "reconnecting" | "closed" }
  | { readonly kind: "auth_required" }
  | { readonly kind: "repair_required"; readonly recovery: CursorRecovery }
  | { readonly kind: "contract_incompatible"; readonly reason: string }

export type OpenEventsInput = {
  readonly sessionId: string
  readonly cursor: SessionCursor | string
  readonly onEvent: (event: SessionEvent, cursor: SessionCursor) => void
  readonly onConnection: (state: SessionConnectionState) => void
}

export type EventStreamHandle = {
  /** Resolves after the first HTTP stream is accepted; rejects on first-connect failure. */
  readonly ready: Promise<void>
  readonly close: () => void
}

export type SessionClient = {
  readonly fetchSnapshot: (sessionId: string) => Promise<SessionSnapshot | null>
  readonly hydrate: (sessionId: string) => Promise<SessionHydration>
  readonly createMessage: (
    sessionId: string,
    body: MessageCreateParams,
  ) => Promise<MessageCreateReceipt>
  readonly sendControl: (
    sessionId: string,
    runId: string,
    body: RunControlBody,
  ) => Promise<RunControlReceipt>
  readonly fetchControlReceipt: (
    sessionId: string,
    runId: string,
    decisionId: string,
  ) => Promise<ControlReceiptView>
  readonly openEvents: (input: OpenEventsInput) => EventStreamHandle
}

type SseFrame = { readonly id: string | null; readonly data: string | null }

function routeSegment(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new SessionClientError("protocol", `${label} must not be empty`)
  }
  return encodeURIComponent(value)
}

function errorDetail(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined
  return typeof body.error === "string" ? body.error : undefined
}

function responseError(
  method: string,
  path: string,
  response: SessionResponse | SessionStreamResponse,
  cursorPolicy: CursorPolicy,
): SessionClientError {
  const detail = "body" in response ? errorDetail(response.body) : undefined
  const message = detail ?? `${method} ${path} failed with status ${response.status}`
  if (response.status === 401 || response.status === 403) {
    return new SessionClientError("auth_required", message, { status: response.status })
  }
  if (response.status === 409) {
    return new SessionClientError("command_conflict", message, { status: response.status })
  }
  if (response.status === 410 || response.status === 412 || response.status === 422) {
    return new SessionClientError("repair_required", message, {
      status: response.status,
      recovery: cursorPolicy.onRejected(response.status),
    })
  }
  return new SessionClientError("http", message, { status: response.status })
}

function parseContract<T>(raw: unknown, parse: (input: unknown) => T): T {
  try {
    return parse(raw)
  } catch (error) {
    throw new SessionClientError("contract_incompatible", "Session payload rejected by Root contract", {
      cause: error instanceof ZodError ? error : undefined,
    })
  }
}

function createSseParser(
  onFrame: (frame: SseFrame) => void,
  maxBufferedBytes: number,
  maxFrameBytes: number,
): {
  readonly push: (chunk: string) => void
  readonly finish: () => void
} {
  let buffer = ""
  let bufferedBytes = 0
  const encoder = new TextEncoder()

  const drain = (final: boolean): void => {
    for (;;) {
      const match = /\r?\n\r?\n/.exec(buffer)
      if (!match) break
      const frame = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      bufferedBytes = encoder.encode(buffer).byteLength
      emit(frame)
    }
    if (final && buffer.length > 0) {
      emit(buffer)
      buffer = ""
    }
  }

  const emit = (frame: string): void => {
    if (encoder.encode(frame).byteLength > maxFrameBytes) {
      throw new SessionClientError("protocol", "SSE frame exceeds the bounded contract limit")
    }
    let id: string | null = null
    const data: string[] = []
    for (const rawLine of frame.split(/\r?\n/)) {
      if (rawLine.startsWith(":")) continue
      const separator = rawLine.indexOf(":")
      const field = separator < 0 ? rawLine : rawLine.slice(0, separator)
      const rawValue = separator < 0 ? "" : rawLine.slice(separator + 1)
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue
      if (field === "id") id = value
      if (field === "data") data.push(value)
    }
    if (id !== null || data.length > 0) {
      onFrame({ id, data: data.length > 0 ? data.join("\n") : null })
    }
  }

  return {
    push(chunk) {
      buffer += chunk
      bufferedBytes += encoder.encode(chunk).byteLength
      if (bufferedBytes > maxBufferedBytes) {
        throw new SessionClientError("protocol", "SSE buffer exceeds the bounded contract limit")
      }
      drain(false)
    },
    finish() {
      drain(true)
    },
  }
}

function snapshotOpaqueCursor(snapshot: SessionSnapshot): unknown {
  // Wave 3 Task 2 adds this generated field. Access through unknown keeps this
  // foundation buildable against the legacy mirror while refusing its numeric watermark.
  const record: Record<string, unknown> = snapshot
  return record.cursor
}

function hasCompleteTypedSnapshot(snapshot: SessionSnapshot): boolean {
  const record: Record<string, unknown> = snapshot
  return Array.isArray(record.messages) && !("event_watermark" in record)
}

export function createSessionClient(options: {
  readonly transport: SessionTransport
  readonly cursorPolicy?: CursorPolicy
  readonly reconnectDelayMs?: number
  readonly reconnectMaxDelayMs?: number
  readonly random?: () => number
  readonly maxSseBufferBytes?: number
  readonly maxSseFrameBytes?: number
}): SessionClient {
  const cursorPolicy = options.cursorPolicy ?? createCursorPolicy()
  const reconnectDelayMs = options.reconnectDelayMs ?? 1_000
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000
  const random = options.random ?? Math.random
  const maxSseBufferBytes = options.maxSseBufferBytes ?? 1_048_576
  const maxSseFrameBytes = options.maxSseFrameBytes ?? 524_288

  const request = async <T>(
    input: SessionRequest,
    expectedStatus: number,
    parse: (raw: unknown) => T,
  ): Promise<T> => {
    let response: SessionResponse
    try {
      response = await options.transport.request(input)
    } catch (error) {
      throw new SessionClientError("network", `${input.method} ${input.path} failed`, { cause: error })
    }
    if (response.status !== expectedStatus) {
      throw responseError(input.method, input.path, response, cursorPolicy)
    }
    return parseContract(response.body, parse)
  }

  const fetchSnapshot = async (sessionId: string): Promise<SessionSnapshot | null> => {
    const path = snapshotPath(routeSegment(sessionId, "sessionId"))
    let response: SessionResponse
    try {
      response = await options.transport.request({ method: "GET", path })
    } catch (error) {
      throw new SessionClientError("network", `GET ${path} failed`, { cause: error })
    }
    if (response.status === 404) return null
    if (response.status !== 200) throw responseError("GET", path, response, cursorPolicy)
    return parseContract(response.body, parseSessionSnapshot)
  }

  return {
    fetchSnapshot,
    async hydrate(sessionId) {
      const snapshot = await fetchSnapshot(sessionId)
      if (snapshot === null) return { kind: "not_found" }
      if (!hasCompleteTypedSnapshot(snapshot)) {
        return {
          kind: "contract_incompatible",
          snapshot,
          reason: "legacy_flat_snapshot",
        }
      }
      const acceptance = cursorPolicy.accept(snapshotOpaqueCursor(snapshot))
      if (acceptance.kind !== "ready") {
        return { ...acceptance, snapshot }
      }
      return { kind: "ready", snapshot, cursor: acceptance.cursor }
    },
    createMessage(sessionId, body) {
      const parsed = parseContract(body, (raw) => messageCreateParamsSchema.parse(raw))
      return request(
        {
          method: "POST",
          path: messagesPath(routeSegment(sessionId, "sessionId")),
          headers: { "content-type": "application/json" },
          body: parsed,
        },
        202,
        (raw) => messageCreateReceiptSchema.parse(raw),
      )
    },
    sendControl(sessionId, runId, body) {
      const parsed = parseContract(body, (raw) => runControlBodySchema.parse(raw))
      return request(
        {
          method: "POST",
          path: controlPath(
            routeSegment(sessionId, "sessionId"),
            routeSegment(runId, "runId"),
          ),
          headers: { "content-type": "application/json" },
          body: parsed,
        },
        202,
        (raw) => runControlReceiptSchema.parse(raw),
      )
    },
    fetchControlReceipt(sessionId, runId, decisionId) {
      return request(
        {
          method: "GET",
          path: controlReceiptPath(
            routeSegment(sessionId, "sessionId"),
            routeSegment(runId, "runId"),
            routeSegment(decisionId, "decisionId"),
          ),
        },
        200,
        (raw) => controlReceiptViewSchema.parse(raw),
      )
    },
    openEvents(input) {
      const initialCursor = cursorPolicy.accept(input.cursor)
      if (initialCursor.kind !== "ready") {
        throw new SessionClientError("contract_incompatible", initialCursor.reason)
      }

      const path = eventsPath(routeSegment(input.sessionId, "sessionId"))
      let cursor = initialCursor.cursor
      let closed = false
      let controller: AbortController | null = null
      let retryTimer: ReturnType<typeof setTimeout> | null = null
      let reconnectAttempt = 0
      let firstConnection = true
      let resolveReady!: () => void
      let rejectReady!: (error: unknown) => void
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })

      const fail = (error: SessionClientError): void => {
        if (firstConnection) rejectReady(error)
        if (error.kind === "auth_required") {
          input.onConnection({ kind: "auth_required" })
        } else if (error.kind === "contract_incompatible") {
          input.onConnection({ kind: "contract_incompatible", reason: error.message })
        } else {
          input.onConnection({
            kind: "repair_required",
            recovery: error.recovery ?? cursorPolicy.onRejected(error.status ?? 500),
          })
        }
      }

      const retryAfterMs = (headers?: Headers): number | null => {
        const raw = headers?.get("retry-after")
        if (!raw) return null
        const seconds = Number(raw)
        if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, reconnectMaxDelayMs)
        const timestamp = Date.parse(raw)
        return Number.isFinite(timestamp)
          ? Math.min(Math.max(0, timestamp - Date.now()), reconnectMaxDelayMs)
          : null
      }

      const scheduleReconnect = (headers?: Headers): void => {
        if (closed) return
        input.onConnection({ kind: "reconnecting" })
        const serverDelay = retryAfterMs(headers)
        const exponentialCap = Math.min(
          reconnectMaxDelayMs,
          reconnectDelayMs * 2 ** Math.min(reconnectAttempt, 20),
        )
        const delay = serverDelay ?? Math.floor(random() * (exponentialCap + 1))
        reconnectAttempt += 1
        retryTimer = setTimeout(() => {
          retryTimer = null
          void connect()
        }, delay)
      }

      const connect = async (): Promise<void> => {
        if (closed) return
        controller = new AbortController()
        input.onConnection({ kind: firstConnection ? "connecting" : "reconnecting" })
        let response: SessionStreamResponse
        try {
          response = await options.transport.stream({
            method: "GET",
            path,
            headers: {
              accept: "text/event-stream",
              [LAST_EVENT_ID_HEADER]: cursor,
            },
            signal: controller.signal,
          })
        } catch (error) {
          if (closed) return
          if (firstConnection) {
            fail(new SessionClientError("network", `GET ${path} failed`, { cause: error }))
            return
          }
          scheduleReconnect()
          return
        }
        if (response.status !== 200 || response.body === null) {
          if (closed) return
          if ([429, 502, 503, 504].includes(response.status)) {
            scheduleReconnect(response.headers)
            return
          }
          fail(responseError("GET", path, response, cursorPolicy))
          return
        }

        input.onConnection({ kind: "live" })
        if (firstConnection) {
          firstConnection = false
          resolveReady()
        }

        let terminalError: SessionClientError | null = null
        const parser = createSseParser((frame) => {
          if (frame.data === null) return
          const acceptance = cursorPolicy.accept(frame.id)
          if (acceptance.kind !== "ready") {
            terminalError = new SessionClientError("contract_incompatible", acceptance.reason)
            controller?.abort()
            return
          }
          let raw: unknown
          try {
            raw = JSON.parse(frame.data)
          } catch (error) {
            terminalError = new SessionClientError("protocol", "SSE data is not JSON", { cause: error })
            controller?.abort()
            return
          }
          let event: SessionEvent
          try {
            event = parseContract(raw, parseSessionEvent)
          } catch (error) {
            terminalError = error instanceof SessionClientError
              ? error
              : new SessionClientError("contract_incompatible", "SSE event rejected by Root contract")
            controller?.abort()
            return
          }
          cursor = acceptance.cursor
          reconnectAttempt = 0
          input.onEvent(event, cursor)
        }, maxSseBufferBytes, maxSseFrameBytes)

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            parser.push(decoder.decode(value, { stream: true }))
            if (terminalError !== null || closed) break
          }
          parser.finish()
        } catch (error) {
          if (error instanceof SessionClientError) terminalError = error
          if (!closed && terminalError === null) {
            scheduleReconnect()
            return
          }
        }
        if (closed) return
        if (terminalError !== null) {
          fail(terminalError)
          return
        }
        scheduleReconnect()
      }

      void connect()
      return {
        ready,
        close() {
          if (closed) return
          closed = true
          controller?.abort()
          if (retryTimer !== null) clearTimeout(retryTimer)
          input.onConnection({ kind: "closed" })
        },
      }
    },
  }
}
