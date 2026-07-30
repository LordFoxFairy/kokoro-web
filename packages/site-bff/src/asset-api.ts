import "server-only"

import type { OpaqueAuthSession } from "@kokoro/bff-runtime"
import type { AssetUploadStatus } from "@kokoro/site-client"
import { PlatformPublicError, PlatformPublicInputError } from "@kokoro/site-client/server"

import type { SiteBffRuntime } from "./index.js"

const MAXIMUM_CONTROL_BODY_BYTES = 65_536
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u
const COMMAND_ID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u
const IDEMPOTENCY_KEY = /^\S{16,191}$/u

export type BrowserAttachmentRef = Readonly<{
  asset_ref: string
  asset_version_ref: string
  asset_grant_ref: string
}>

export type BrowserAssetUpload = Readonly<{
  intentRef: string
  sessionRef: string
  expectedVersion: string
  expectedSize: string
  clientMediaType: string
  purpose: string
  safeDisplayName: string
  stage: AssetUploadStatus["stage"]
  terminal: boolean
  retryClass: AssetUploadStatus["retryClass"]
  retryAfter: string | null
  safeReasonCode: string | null
  attachment: BrowserAttachmentRef | null
}>

function uploadProjection(upload: AssetUploadStatus): BrowserAssetUpload {
  return Object.freeze({
    intentRef: upload.intentRef,
    sessionRef: upload.sessionRef,
    expectedVersion: upload.expectedVersion,
    expectedSize: upload.expectedSize,
    clientMediaType: upload.clientMediaType,
    purpose: upload.purpose,
    safeDisplayName: upload.safeDisplayName,
    stage: upload.stage,
    terminal: upload.terminal,
    retryClass: upload.retryClass,
    retryAfter: upload.retryAfter,
    safeReasonCode: upload.safeReasonCode,
    attachment: upload.trustedGrant === null ? null : Object.freeze({
      asset_ref: upload.trustedGrant.assetRef,
      asset_version_ref: upload.trustedGrant.assetVersionRef,
      asset_grant_ref: upload.trustedGrant.assetGrantRef,
    }),
  })
}

function problem(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, {
    status,
    headers: { "cache-control": "no-store" },
  })
}

async function boundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "application/json") throw new SyntaxError("content type")
  const declared = request.headers.get("content-length")
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_CONTROL_BODY_BYTES)) {
    await request.body?.cancel("body too large").catch(() => undefined)
    throw new RangeError("body too large")
  }
  if (request.body === null) throw new SyntaxError("missing body")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAXIMUM_CONTROL_BODY_BYTES) {
        await reader.cancel("body too large")
        throw new RangeError("body too large")
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new SyntaxError("object")
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).some((key) => !keys.includes(key)) || keys.some((key) => !(key in candidate))) {
    throw new SyntaxError("shape")
  }
  return candidate
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new SyntaxError("text")
  return value
}

function command(value: unknown): Readonly<{ commandId: string; idempotencyKey: string }> {
  const candidate = record(value, ["commandId", "idempotencyKey"])
  const commandId = text(candidate.commandId)
  const idempotencyKey = text(candidate.idempotencyKey)
  if (!COMMAND_ID.test(commandId) || !IDEMPOTENCY_KEY.test(idempotencyKey)) throw new SyntaxError("command")
  return Object.freeze({ commandId, idempotencyKey })
}

function createInput(value: unknown) {
  const candidate = record(value, [
    "command", "clientMediaType", "expectedChecksumSha256", "expectedSize", "filename", "purpose",
  ])
  return Object.freeze({
    command: command(candidate.command),
    upload: Object.freeze({
      clientMediaType: text(candidate.clientMediaType),
      expectedChecksumSha256: text(candidate.expectedChecksumSha256),
      expectedSize: text(candidate.expectedSize),
      filename: text(candidate.filename),
      purpose: text(candidate.purpose),
    }),
  })
}

function completeInput(value: unknown) {
  const candidate = record(value, ["command", "expectedVersion", "sessionRef"])
  return Object.freeze({
    command: command(candidate.command),
    completion: Object.freeze({
      expectedVersion: text(candidate.expectedVersion),
      sessionRef: text(candidate.sessionRef),
    }),
  })
}

export interface SiteAssetApi {
  handle(request: Request, path: readonly string[]): Promise<Response>
}

/** Browser control plane for Asset owner operations. It is an allowlisted composition, never a generic Platform proxy. */
export function createSiteAssetApi(input: Readonly<{
  runtime: SiteBffRuntime
  readAuthSession(): Promise<OpaqueAuthSession | null> | OpaqueAuthSession | null
}>): SiteAssetApi {
  return Object.freeze({
    async handle(request: Request, path: readonly string[]) {
      try {
        if (new URL(request.url).origin !== input.runtime.publicOrigin || request.headers.get("sec-fetch-site") !== "same-origin") {
          return problem(403, "REQUEST_REJECTED", "Browser request was rejected")
        }
        const mutation = request.method === "POST"
        if (mutation && (
          request.headers.get("origin") !== input.runtime.publicOrigin ||
          !input.runtime.verifyBrowserMutation({
            operationId: "asset.upload",
            token: request.headers.get("x-kokoro-browser-csrf") ?? "",
          })
        )) return problem(403, "REQUEST_REJECTED", "Browser request was rejected")

        const auth = await input.readAuthSession()
        if (auth === null) return problem(401, "AUTH_REQUIRED", "Sign in again")

        if (request.method === "POST" && path.length === 0) {
          const parsed = createInput(await boundedJson(request))
          const response = await input.runtime.createAssetUploadIntent(auth, parsed.upload, parsed.command)
          return Response.json({ capability: response.capability, upload: uploadProjection(response.upload) }, {
            status: 201,
            headers: { "cache-control": "no-store" },
          })
        }
        if (request.method === "GET" && path.length === 1 && REFERENCE.test(path[0] ?? "")) {
          const response = await input.runtime.getAssetUploadStatus(auth, path[0] as string)
          return Response.json({ upload: uploadProjection(response.upload) }, {
            headers: { "cache-control": "no-store" },
          })
        }
        if (
          request.method === "POST" && path.length === 2 && path[1] === "complete" &&
          REFERENCE.test(path[0] ?? "")
        ) {
          const parsed = completeInput(await boundedJson(request))
          const response = await input.runtime.completeAssetUpload(
            auth,
            path[0] as string,
            parsed.completion,
            parsed.command,
          )
          if (response.upload === null) return problem(503, "OUTCOME_UNKNOWN", "Upload completion is reconciling")
          return Response.json({ upload: uploadProjection(response.upload) }, {
            status: 202,
            headers: { "cache-control": "no-store" },
          })
        }
        return problem(404, "NOT_FOUND", "Asset operation was not found")
      } catch (error) {
        if (error instanceof RangeError) return problem(413, "PAYLOAD_TOO_LARGE", "Request body is too large")
        if (error instanceof SyntaxError || error instanceof PlatformPublicInputError) {
          return problem(400, "REQUEST_INVALID", "Asset request was invalid")
        }
        if (error instanceof PlatformPublicError) {
          return problem(error.status, error.detail.code, error.detail.safeMessage)
        }
        return problem(503, "INTERNAL_UNAVAILABLE", "Asset service is temporarily unavailable")
      }
    },
  })
}
