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
