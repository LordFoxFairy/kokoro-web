import "server-only"

import type { OpaqueAuthSession } from "@kokoro/bff-runtime"
import type {
  MemoryCategory,
  MemoryCommandResponse,
  MemoryCorrectInput,
  MemoryEntryHistoryPage,
  MemoryEntryPage,
  MemoryEntryResponse,
  MemoryExportInput,
  MemoryExportResponse,
  MemoryForgetInput,
  MemoryImportInput,
  MemoryImportResponse,
  MemoryPriorityInput,
  MemoryRememberInput,
  MemoryResetInput,
  MemoryRestoreInput,
  MemorySettings,
  MemorySettingsUpdateInput,
  MemorySourceKind,
} from "@kokoro/site-client"
import {
  zCommandIdentity,
  zMemoryCategory,
  zMemoryCorrectInput,
  zMemoryEntryRef,
  zMemoryExportInput,
  zMemoryExportRef,
  zMemoryForgetInput,
  zMemoryImportInput,
  zMemoryImportRef,
  zMemoryPriorityInput,
  zMemoryRememberInput,
  zMemoryResetInput,
  zMemoryRestoreInput,
  zMemoryRevisionRef,
  zMemorySettingsUpdateInput,
  zMemorySourceKind,
} from "@kokoro/site-client"
import {
  PlatformPublicError,
  PlatformPublicInputError,
  PlatformPublicProtocolError,
  type PublicCommandContext,
  type createPlatformPublicClient,
} from "@kokoro/site-client/server"

import { waitWithinBudget, type SiteRequestBudget } from "./request-budget.js"

const MAXIMUM_REQUEST_BYTES = 65_536
const MAXIMUM_RESPONSE_BYTES = 2_097_152
const MEMORY_REQUEST_DEADLINE_MS = 30_000
const MAXIMUM_MEMORY_CONTENT_UTF8_BYTES = 16_384
const IDEMPOTENCY_KEY = /^\S{16,191}$/u

type PlatformClient = ReturnType<typeof createPlatformPublicClient>

export type SiteMemoryPageQuery = Readonly<{
  category?: MemoryCategory
  source?: MemorySourceKind
  cursor?: string
  limit?: number
}>

export type SiteMemoryHistoryQuery = Readonly<{ cursor?: string; limit?: number }>
export type SiteMemoryRequestOptions = Readonly<{ signal: AbortSignal; deadlineMs: number }>

export interface SiteMemoryAuthority {
  getSettings(options: SiteMemoryRequestOptions): Promise<MemorySettings>
  updateSettings(input: MemorySettingsUpdateInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>
  listEntries(query: SiteMemoryPageQuery, options: SiteMemoryRequestOptions): Promise<MemoryEntryPage>
  remember(input: MemoryRememberInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>
  getEntry(entryRef: string, options: SiteMemoryRequestOptions): Promise<MemoryEntryResponse>
  listHistory(entryRef: string, query: SiteMemoryHistoryQuery, options: SiteMemoryRequestOptions): Promise<MemoryEntryHistoryPage>
  restore(entryRef: string, revisionRef: string, input: MemoryRestoreInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>
  correct(entryRef: string, input: MemoryCorrectInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>
  prioritize(entryRef: string, input: MemoryPriorityInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>
  deprioritize(entryRef: string, input: MemoryPriorityInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>
  forget(entryRef: string, input: MemoryForgetInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>
  reset(input: MemoryResetInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>
  requestExport(input: MemoryExportInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>
  getExport(exportRef: string, options: SiteMemoryRequestOptions): Promise<MemoryExportResponse>
  requestImport(input: MemoryImportInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>
  getImport(importRef: string, options: SiteMemoryRequestOptions): Promise<MemoryImportResponse>
  recoverCommand(commandId: string, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>
}

export interface SiteMemoryApiRuntime {
  readonly publicOrigin: string
  verifyBrowserMutation(input: Readonly<{ operationId: string; token: string }>): boolean
  memory(auth: OpaqueAuthSession, budget: SiteRequestBudget): Promise<SiteMemoryAuthority>
}

export interface SiteMemoryApi {
  handle(request: Request, path: readonly string[]): Promise<Response>
}

interface RuntimeSchema<Value> {
  safeParse(input: unknown):
    | Readonly<{ success: true; data: Value }>
    | Readonly<{ success: false }>
}

class MemoryResponseLimitError extends Error {
  constructor() {
    super("Memory response exceeded its browser boundary")
    this.name = "MemoryResponseLimitError"
  }
}

function requestBudget(signal: AbortSignal, monotonicNow: () => number): SiteRequestBudget {
  const startedAt = monotonicNow()
  return Object.freeze({
    signal,
    remainingDeadlineMs() {
      const remaining = MEMORY_REQUEST_DEADLINE_MS - Math.max(0, monotonicNow() - startedAt)
      if (!Number.isFinite(remaining) || remaining < 1) throw new Error("Memory request deadline exhausted")
      return Math.max(1, Math.floor(remaining))
    },
  })
}

function safeHeaders(): Readonly<Record<string, string>> {
  return Object.freeze({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  })
}

function problem(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: safeHeaders() })
}

function boundedResponse(value: unknown, status = 200): Response {
  const body = JSON.stringify(value)
  if (body === undefined || new TextEncoder().encode(body).byteLength > MAXIMUM_RESPONSE_BYTES) {
    throw new MemoryResponseLimitError()
  }
  return new Response(body, { status, headers: safeHeaders() })
}

function outcomeUnknown(commandId: string): Response {
  return boundedResponse({
    error: {
      code: "OUTCOME_UNKNOWN",
      message: "Memory command outcome is being reconciled",
    },
    recovery: {
      commandId,
      href: `/api/memory/commands/${encodeURIComponent(commandId)}`,
      method: "GET",
    },
  }, 503)
}

async function boundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "application/json") throw new SyntaxError("content type")
  const declared = request.headers.get("content-length")
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_REQUEST_BYTES)) {
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
      if (size > MAXIMUM_REQUEST_BYTES) {
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
  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new SyntaxError("utf-8")
  }
  return JSON.parse(decoded)
}

function closedRecord(value: unknown, required: readonly string[]): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new SyntaxError("object")
  const record = value as Readonly<Record<string, unknown>>
  const keys = Object.keys(record)
  if (keys.length !== required.length || required.some((key) => !Object.hasOwn(record, key))) {
    throw new SyntaxError("shape")
  }
  return record
}

function parse<Value>(schema: RuntimeSchema<Value>, value: unknown): Value {
  const result = schema.safeParse(value)
  if (!result.success) throw new SyntaxError("contract input")
  return result.data
}

function unicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}

function content(value: string): string {
  if (!unicodeScalars(value) || new TextEncoder().encode(value).byteLength > MAXIMUM_MEMORY_CONTENT_UTF8_BYTES) {
    throw new SyntaxError("content")
  }
  return value
}

function parseCommand(value: unknown): PublicCommandContext {
  const input = closedRecord(value, ["commandId", "idempotencyKey"])
  const commandId = parse(zCommandIdentity, input.commandId)
  const idempotencyKey = input.idempotencyKey
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new SyntaxError("idempotency key")
  }
  return Object.freeze({ commandId, idempotencyKey })
}

async function mutationInput<Value>(request: Request, schema: RuntimeSchema<Value>): Promise<Readonly<{
  command: PublicCommandContext
  input: Value
}>> {
  const value = closedRecord(await boundedJson(request), ["command", "input"])
  return Object.freeze({ command: parseCommand(value.command), input: parse(schema, value.input) })
}

function noQuery(url: URL): void {
  if (url.search !== "") throw new SyntaxError("query")
}

function uniqueQuery(url: URL, allowed: readonly string[]): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new SyntaxError("query")
  }
  for (const key of allowed) {
    const value = url.searchParams.get(key)
    if (value !== null) result[key] = value
  }
  return Object.freeze(result)
}

function pageQuery(url: URL, memoryFilters: boolean): SiteMemoryPageQuery {
  const raw = uniqueQuery(url, memoryFilters
    ? ["category", "source", "cursor", "limit"]
    : ["cursor", "limit"])
  const cursor = raw.cursor
  if (cursor !== undefined && (cursor.length < 1 || cursor.length > 2_048)) throw new SyntaxError("cursor")
  const limit = raw.limit
  if (limit !== undefined && (!/^[1-9][0-9]{0,2}$/u.test(limit) || Number(limit) > 100)) {
    throw new SyntaxError("limit")
  }
  return Object.freeze({
    ...(raw.category === undefined ? {} : { category: parse(zMemoryCategory, raw.category) }),
    ...(raw.source === undefined ? {} : { source: parse(zMemorySourceKind, raw.source) }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit: Number(limit) }),
  })
}

function historyQuery(url: URL): SiteMemoryHistoryQuery {
  const query = pageQuery(url, false)
  return Object.freeze({
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  })
}

function reference(schema: RuntimeSchema<string>, value: string | undefined): string {
  return parse(schema, value)
}

function requestOptions(budget: SiteRequestBudget): SiteMemoryRequestOptions {
  return Object.freeze({ signal: budget.signal, deadlineMs: budget.remainingDeadlineMs() })
}

function callWithinBudget<Value>(
  budget: SiteRequestBudget,
  call: (options: SiteMemoryRequestOptions) => Promise<Value>,
): Promise<Value> {
  const options = requestOptions(budget)
  return waitWithinBudget(call(options), budget)
}

function knownRoute(method: string, path: readonly string[]): boolean {
  if (method === "GET") {
    return (
      (path.length === 1 && (path[0] === "settings" || path[0] === "entries")) ||
      (path.length === 2 && (path[0] === "entries" || path[0] === "exports" || path[0] === "imports" || path[0] === "commands")) ||
      (path.length === 3 && path[0] === "entries" && path[2] === "history")
    )
  }
  if (method === "PATCH") return path.length === 1 && path[0] === "settings"
  if (method !== "POST") return false
  return (
    (path.length === 1 && (path[0] === "entries" || path[0] === "reset" || path[0] === "exports" || path[0] === "imports")) ||
    (path.length === 3 && path[0] === "entries" && ["correct", "prioritize", "deprioritize", "forget"].includes(path[2] ?? "")) ||
    (path.length === 5 && path[0] === "entries" && path[2] === "history" && path[4] === "restore")
  )
}

/** Server-resolved Memory authority. Site, subject, Project, space and namespace never enter this port. */
export function createSiteMemoryAuthority(input: Readonly<{ platform: PlatformClient }>): SiteMemoryAuthority {
  const authority: SiteMemoryAuthority = {
    getSettings: (options) => input.platform.execute({ operationId: "getMemorySettings", data: {}, ...options }),
    updateSettings: (settingsInput, command, options) => input.platform.execute({ operationId: "updateMemorySettings", data: { body: settingsInput }, command, ...options }),
    listEntries: (query, options) => input.platform.execute({ operationId: "listMemoryEntries", data: { query }, ...options }),
    remember: (memoryInput, command, options) => input.platform.execute({ operationId: "rememberMemoryEntry", data: { body: memoryInput }, command, ...options }),
    getEntry: (entryRef, options) => input.platform.execute({ operationId: "getMemoryEntry", data: { path: { entryRef } }, ...options }),
    listHistory: (entryRef, query, options) => input.platform.execute({ operationId: "listMemoryEntryHistory", data: { path: { entryRef }, query }, ...options }),
    restore: (entryRef, revisionRef, restoreInput, command, options) => input.platform.execute({ operationId: "restoreMemoryEntryRevision", data: { path: { entryRef, revisionRef }, body: restoreInput }, command, ...options }),
    correct: (entryRef, correctInput, command, options) => input.platform.execute({ operationId: "correctMemoryEntry", data: { path: { entryRef }, body: correctInput }, command, ...options }),
    prioritize: (entryRef, priorityInput, command, options) => input.platform.execute({ operationId: "prioritizeMemoryEntry", data: { path: { entryRef }, body: priorityInput }, command, ...options }),
    deprioritize: (entryRef, priorityInput, command, options) => input.platform.execute({ operationId: "deprioritizeMemoryEntry", data: { path: { entryRef }, body: priorityInput }, command, ...options }),
    forget: (entryRef, forgetInput, command, options) => input.platform.execute({ operationId: "forgetMemoryEntry", data: { path: { entryRef }, body: forgetInput }, command, ...options }),
    reset: (resetInput, command, options) => input.platform.execute({ operationId: "resetMemorySpace", data: { body: resetInput }, command, ...options }),
    requestExport: (exportInput, command, options) => input.platform.execute({ operationId: "requestMemoryExport", data: { body: exportInput }, command, ...options }),
    getExport: (exportRef, options) => input.platform.execute({ operationId: "getMemoryExport", data: { path: { exportRef } }, ...options }),
    requestImport: (importInput, command, options) => input.platform.execute({ operationId: "requestMemoryImport", data: { body: importInput }, command, ...options }),
    getImport: (importRef, options) => input.platform.execute({ operationId: "getMemoryImport", data: { path: { importRef } }, ...options }),
    recoverCommand: (commandId, options) => input.platform.execute({ operationId: "recoverMemoryCommand", data: { path: { commandId } }, ...options }),
  }
  return Object.freeze(authority)
}

/** Exact same-origin Memory composition. It is deliberately not a generic Platform proxy. */
export function createSiteMemoryApi(input: Readonly<{
  runtime: SiteMemoryApiRuntime
  readAuthSession(budget: SiteRequestBudget): Promise<OpaqueAuthSession | null> | OpaqueAuthSession | null
  monotonicNow?: () => number
}>): SiteMemoryApi {
  return Object.freeze({
    async handle(request: Request, path: readonly string[]): Promise<Response> {
      const budget = requestBudget(request.signal, input.monotonicNow ?? (() => performance.now()))
      let dispatchedCommandId: string | undefined
      try {
        const url = new URL(request.url)
        if (url.origin !== input.runtime.publicOrigin || request.headers.get("sec-fetch-site") !== "same-origin") {
          return problem(403, "REQUEST_REJECTED", "Browser request was rejected")
        }
        if (!knownRoute(request.method, path)) return problem(404, "NOT_FOUND", "Memory operation was not found")
        const mutation = request.method === "PATCH" || request.method === "POST"
        if (mutation && (
          request.headers.get("origin") !== input.runtime.publicOrigin ||
          !input.runtime.verifyBrowserMutation({
            operationId: "memory.control",
            token: request.headers.get("x-kokoro-browser-csrf") ?? "",
          })
        )) return problem(403, "REQUEST_REJECTED", "Browser request was rejected")

        const auth = await waitWithinBudget(Promise.resolve(input.readAuthSession(budget)), budget)
        if (auth === null) return problem(401, "AUTH_REQUIRED", "Sign in again")
        const memory = await waitWithinBudget(input.runtime.memory(auth, budget), budget)

        if (request.method === "GET" && path.length === 1 && path[0] === "settings") {
          noQuery(url)
          return boundedResponse(await callWithinBudget(budget, (options) => memory.getSettings(options)))
        }
        if (request.method === "PATCH" && path.length === 1 && path[0] === "settings") {
          noQuery(url)
          const parsed = await mutationInput(request, zMemorySettingsUpdateInput)
          dispatchedCommandId = parsed.command.commandId
          return boundedResponse(await callWithinBudget(budget, (options) => memory.updateSettings(parsed.input, parsed.command, options)), 202)
        }
        if (request.method === "GET" && path.length === 1 && path[0] === "entries") {
          const query = pageQuery(url, true)
          return boundedResponse(await callWithinBudget(budget, (options) => memory.listEntries(query, options)))
        }
        if (request.method === "POST" && path.length === 1 && path[0] === "entries") {
          noQuery(url)
          const parsed = await mutationInput(request, zMemoryRememberInput)
          content(parsed.input.content)
          dispatchedCommandId = parsed.command.commandId
          return boundedResponse(await callWithinBudget(budget, (options) => memory.remember(parsed.input, parsed.command, options)), 202)
        }
        if (request.method === "GET" && path.length === 2 && path[0] === "entries") {
          noQuery(url)
          const entryRef = reference(zMemoryEntryRef, path[1])
          return boundedResponse(await callWithinBudget(budget, (options) => memory.getEntry(entryRef, options)))
        }
        if (request.method === "GET" && path.length === 3 && path[0] === "entries" && path[2] === "history") {
          const entryRef = reference(zMemoryEntryRef, path[1])
          const query = historyQuery(url)
          return boundedResponse(await callWithinBudget(budget, (options) => memory.listHistory(entryRef, query, options)))
        }
        if (request.method === "POST" && path.length === 5 && path[0] === "entries" && path[2] === "history" && path[4] === "restore") {
          noQuery(url)
          const entryRef = reference(zMemoryEntryRef, path[1])
          const revisionRef = reference(zMemoryRevisionRef, path[3])
          const parsed = await mutationInput(request, zMemoryRestoreInput)
          dispatchedCommandId = parsed.command.commandId
          return boundedResponse(await callWithinBudget(budget, (options) => memory.restore(entryRef, revisionRef, parsed.input, parsed.command, options)), 202)
        }
        if (request.method === "POST" && path.length === 3 && path[0] === "entries" && path[2] === "correct") {
          noQuery(url)
          const entryRef = reference(zMemoryEntryRef, path[1])
          const parsed = await mutationInput(request, zMemoryCorrectInput)
          content(parsed.input.content)
          dispatchedCommandId = parsed.command.commandId
          return boundedResponse(await callWithinBudget(budget, (options) => memory.correct(entryRef, parsed.input, parsed.command, options)), 202)
        }
        if (request.method === "POST" && path.length === 3 && path[0] === "entries" && path[2] === "prioritize") {
          noQuery(url)
          const entryRef = reference(zMemoryEntryRef, path[1])
          const parsed = await mutationInput(request, zMemoryPriorityInput)
          dispatchedCommandId = parsed.command.commandId
          return boundedResponse(await callWithinBudget(budget, (options) => memory.prioritize(entryRef, parsed.input, parsed.command, options)), 202)
        }
        if (request.method === "POST" && path.length === 3 && path[0] === "entries" && path[2] === "deprioritize") {
          noQuery(url)
          const entryRef = reference(zMemoryEntryRef, path[1])
          const parsed = await mutationInput(request, zMemoryPriorityInput)
          dispatchedCommandId = parsed.command.commandId
          return boundedResponse(await callWithinBudget(budget, (options) => memory.deprioritize(entryRef, parsed.input, parsed.command, options)), 202)
        }
        if (request.method === "POST" && path.length === 3 && path[0] === "entries" && path[2] === "forget") {
          noQuery(url)
          const entryRef = reference(zMemoryEntryRef, path[1])
          const parsed = await mutationInput(request, zMemoryForgetInput)
          dispatchedCommandId = parsed.command.commandId
          return boundedResponse(await callWithinBudget(budget, (options) => memory.forget(entryRef, parsed.input, parsed.command, options)), 202)
        }
        if (request.method === "POST" && path.length === 1 && path[0] === "reset") {
          noQuery(url)
          const parsed = await mutationInput(request, zMemoryResetInput)
          dispatchedCommandId = parsed.command.commandId
          return boundedResponse(await callWithinBudget(budget, (options) => memory.reset(parsed.input, parsed.command, options)), 202)
        }
        if (request.method === "POST" && path.length === 1 && path[0] === "exports") {
          noQuery(url)
          const parsed = await mutationInput(request, zMemoryExportInput)
          dispatchedCommandId = parsed.command.commandId
          return boundedResponse(await callWithinBudget(budget, (options) => memory.requestExport(parsed.input, parsed.command, options)), 202)
        }
        if (request.method === "GET" && path.length === 2 && path[0] === "exports") {
          noQuery(url)
          const exportRef = reference(zMemoryExportRef, path[1])
          return boundedResponse(await callWithinBudget(budget, (options) => memory.getExport(exportRef, options)))
        }
        if (request.method === "POST" && path.length === 1 && path[0] === "imports") {
          noQuery(url)
          const parsed = await mutationInput(request, zMemoryImportInput)
          dispatchedCommandId = parsed.command.commandId
          return boundedResponse(await callWithinBudget(budget, (options) => memory.requestImport(parsed.input, parsed.command, options)), 202)
        }
        if (request.method === "GET" && path.length === 2 && path[0] === "imports") {
          noQuery(url)
          const importRef = reference(zMemoryImportRef, path[1])
          return boundedResponse(await callWithinBudget(budget, (options) => memory.getImport(importRef, options)))
        }
        if (request.method === "GET" && path.length === 2 && path[0] === "commands") {
          noQuery(url)
          const commandId = reference(zCommandIdentity, path[1])
          return boundedResponse(await callWithinBudget(budget, (options) => memory.recoverCommand(commandId, options)))
        }
        return problem(404, "NOT_FOUND", "Memory operation was not found")
      } catch (error) {
        if (error instanceof RangeError) return problem(413, "PAYLOAD_TOO_LARGE", "Request body is too large")
        if (error instanceof SyntaxError || error instanceof PlatformPublicInputError) {
          return problem(400, "REQUEST_INVALID", "Memory request was invalid")
        }
        if (error instanceof PlatformPublicError) return problem(error.status, error.detail.code, error.detail.safeMessage)
        if (dispatchedCommandId !== undefined) return outcomeUnknown(dispatchedCommandId)
        if (error instanceof MemoryResponseLimitError) {
          return problem(502, "UPSTREAM_RESPONSE_TOO_LARGE", "Memory upstream response was too large")
        }
        if (error instanceof PlatformPublicProtocolError) {
          return problem(502, error.code, "Memory upstream response was invalid")
        }
        return problem(503, "INTERNAL_UNAVAILABLE", "Memory service is temporarily unavailable")
      }
    },
  })
}
