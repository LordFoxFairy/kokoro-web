// 服务端 HTTP 边界的内存上限。所有浏览器请求体与必须解析的上游响应都经本文件读取，禁止直接
// request.arrayBuffer()/text()/json() 或 response.json() 形成无界缓冲。

const KiB = 1024
const MiB = 1024 * KiB

// Auth 只有 email/team id 等小 JSON；Team 是邀请/角色变更 JSON。
export const AUTH_REQUEST_BODY_MAX_BYTES = 16 * KiB
export const TEAM_REQUEST_BODY_MAX_BYTES = 64 * KiB
// Session 当前写面是 message/share/control JSON，不承载文件上传。
export const SESSION_REQUEST_BODY_MAX_BYTES = 1 * MiB
// Hub 普通 MCP/skill mutation 是小 JSON；skill zip upload 与 Hub Fastify UPLOAD_BODY_LIMIT 对齐。
export const HUB_REQUEST_BODY_MAX_BYTES = 256 * KiB
export const HUB_UPLOAD_REQUEST_BODY_MAX_BYTES = 96 * MiB

// 必须解析 JSON 的内部响应按实际契约分别设限；代理的大文件/SSE 响应不解析、直接流式转发。
export const SITE_RESPONSE_BODY_MAX_BYTES = 64 * KiB
export const AUTH_RESPONSE_BODY_MAX_BYTES = 256 * KiB
export const PAYMENT_RESPONSE_BODY_MAX_BYTES = 1 * MiB

export type BoundedBodyResult =
  | { ok: true; body: ArrayBuffer | undefined }
  | { ok: false; reason: "too_large" | "invalid" }

function declaredLength(headers: Headers): bigint | null | "invalid" {
  const raw = headers.get("content-length")
  if (raw === null) {
    return null
  }
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    return "invalid"
  }
  try {
    return BigInt(trimmed)
  } catch {
    return "invalid"
  }
}

function requestBodyPreflight(headers: Headers, maxBytes: number): "ok" | "too_large" | "invalid" {
  const declared = declaredLength(headers)
  if (declared === "invalid") return "invalid"
  return declared !== null && declared > BigInt(maxBytes) ? "too_large" : "ok"
}

async function cancelQuietly(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  await stream?.cancel().catch(() => undefined)
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  headers: Headers,
  maxBytes: number,
): Promise<BoundedBodyResult> {
  const declared = declaredLength(headers)
  if (declared === "invalid") {
    await cancelQuietly(stream)
    return { ok: false, reason: "invalid" }
  }
  if (declared !== null && declared > BigInt(maxBytes)) {
    await cancelQuietly(stream)
    return { ok: false, reason: "too_large" }
  }
  if (stream === null) {
    return { ok: true, body: undefined }
  }

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, reason: "too_large" }
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    return { ok: false, reason: "invalid" }
  } finally {
    reader.releaseLock()
  }

  if (total === 0) {
    return { ok: true, body: undefined }
  }
  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, body: combined.buffer }
}

export function readBoundedRequestBody(request: Request, maxBytes: number): Promise<BoundedBodyResult> {
  return readBoundedStream(request.body, request.headers, maxBytes)
}

export async function readBoundedRequestJson(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: "too_large" | "invalid" }> {
  const result = await readBoundedRequestBody(request, maxBytes)
  if (!result.ok) {
    return result
  }
  if (result.body === undefined) {
    return { ok: false, reason: "invalid" }
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(result.body)) as unknown }
  } catch {
    return { ok: false, reason: "invalid" }
  }
}

export async function readBoundedResponseJson(response: Response, maxBytes: number): Promise<unknown | null> {
  const result = await readBoundedStream(response.body, response.headers, maxBytes)
  if (!result.ok || result.body === undefined) {
    return null
  }
  try {
    return JSON.parse(new TextDecoder().decode(result.body)) as unknown
  } catch {
    return null
  }
}

export function hubRequestBodyLimit(path: readonly string[]): number {
  return path.length === 4 &&
    path[0] === "self" &&
    path[1] === "skills" &&
    path[2] === "upload" &&
    (path[3] === "preview" || path[3] === "confirm")
    ? HUB_UPLOAD_REQUEST_BODY_MAX_BYTES
    : HUB_REQUEST_BODY_MAX_BYTES
}

export function isHubUploadPath(path: readonly string[]): boolean {
  return hubRequestBodyLimit(path) === HUB_UPLOAD_REQUEST_BODY_MAX_BYTES
}

class RequestBodyTooLargeError extends Error {}

export type CountedBodyCompletion =
  | { ok: true }
  | { ok: false; reason: "too_large" | "invalid" | "aborted" }

export type CountedRequestBodyResult =
  | { ok: false; reason: "too_large" | "invalid" }
  | {
      ok: true
      body: ReadableStream<Uint8Array> | undefined
      completion: Promise<CountedBodyCompletion>
      signal: AbortSignal
      abort: (reason?: unknown) => void
    }

// 大上传只计数、绝不聚合进内存。pipeTo 受客户端 signal 与内部 abort 双重控制；只有源流完整 EOF
// 才把 completion 标为 ok，供 route 在此之后执行 refresh rotation。
export async function prepareCountedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<CountedRequestBodyResult> {
  const preflight = requestBodyPreflight(request.headers, maxBytes)
  if (preflight !== "ok") {
    await cancelQuietly(request.body)
    return { ok: false, reason: preflight }
  }

  const internalAbort = new AbortController()
  const abort = (reason?: unknown): void => {
    if (!internalAbort.signal.aborted) internalAbort.abort(reason)
  }
  if (request.body === null) {
    return {
      ok: true,
      body: undefined,
      completion: Promise.resolve({ ok: true }),
      signal: internalAbort.signal,
      abort,
    }
  }

  let total = 0
  const counted = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength
      if (total > maxBytes) throw new RequestBodyTooLargeError()
      controller.enqueue(chunk)
    },
  })
  const pipeSignal = AbortSignal.any([request.signal, internalAbort.signal])
  const completion: Promise<CountedBodyCompletion> = request.body
    .pipeTo(counted.writable, { signal: pipeSignal })
    .then(() => ({ ok: true }) as const)
    .catch((error: unknown) => {
      abort(error)
      if (error instanceof RequestBodyTooLargeError) return { ok: false, reason: "too_large" } as const
      if (request.signal.aborted) return { ok: false, reason: "aborted" } as const
      return { ok: false, reason: "invalid" } as const
    })

  return { ok: true, body: counted.readable, completion, signal: internalAbort.signal, abort }
}

const HUB_UPLOAD_MAX_CONCURRENT = 2
const HUB_UPLOAD_MAX_RESERVED_BYTES = 128 * MiB
const HUB_UPLOAD_BUSY_RETRY_SECONDS = 1
const HUB_UPLOAD_CAPACITY_RETRY_SECONDS = 2

let activeHubUploads = 0
let reservedHubUploadBytes = 0

export interface HubUploadLease {
  release(): void
}

export type HubUploadAdmission =
  | { ok: true; lease: HubUploadLease }
  | { ok: false; status: 429 | 503; error: "hub_upload_busy" | "hub_upload_capacity_unavailable"; retryAfter: number }

export function acquireHubUploadLease(headers: Headers): HubUploadAdmission {
  if (activeHubUploads >= HUB_UPLOAD_MAX_CONCURRENT) {
    return { ok: false, status: 429, error: "hub_upload_busy", retryAfter: HUB_UPLOAD_BUSY_RETRY_SECONDS }
  }
  const declared = declaredLength(headers)
  const reservation =
    declared === null || declared === "invalid" ? HUB_UPLOAD_REQUEST_BODY_MAX_BYTES : Number(declared)
  if (reservedHubUploadBytes + reservation > HUB_UPLOAD_MAX_RESERVED_BYTES) {
    return {
      ok: false,
      status: 503,
      error: "hub_upload_capacity_unavailable",
      retryAfter: HUB_UPLOAD_CAPACITY_RETRY_SECONDS,
    }
  }

  activeHubUploads += 1
  reservedHubUploadBytes += reservation
  let released = false
  return {
    ok: true,
    lease: {
      release() {
        if (released) return
        released = true
        activeHubUploads -= 1
        reservedHubUploadBytes -= reservation
      },
    },
  }
}
