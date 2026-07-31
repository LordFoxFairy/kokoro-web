import type {
  MemoryCategory,
  MemoryCommandKind,
  MemoryCommandResponse,
  MemoryCorrectInput,
  MemoryEntryActiveView,
  MemoryEntryHistoryPage,
  MemoryEntryPage,
  MemoryEntryResponse,
  MemoryEntryView,
  MemoryArtifactDownloadRequest,
  MemoryExportInput,
  MemoryExportStatus,
  MemoryForgetInput,
  MemoryImportInput,
  MemoryImportResponse,
  MemoryImportStatus,
  MemoryPriorityInput,
  MemoryRememberInput,
  MemoryResetInput,
  MemoryRestoreInput,
  MemoryRevisionView,
  MemorySettings,
  MemorySettingsUpdateInput,
  MemorySourceKind,
} from "@kokoro/site-client"
import {
  zMemoryCommandResponse,
  zMemoryEntryHistoryPage,
  zMemoryEntryPage,
  zMemoryEntryRef,
  zMemoryEntryResponse,
  zMemoryExportResponse,
  zMemoryExportRef,
  zMemoryImportResponse,
  zMemoryImportRef,
  zMemoryRevisionRef,
  zMemorySettings,
} from "@kokoro/site-client"

export type MemoryBrowserFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type MemoryCommandIdentity = Readonly<{ commandId: string; idempotencyKey: string }>
export type MemoryPageQuery = Readonly<{
  category?: MemoryCategory
  source?: MemorySourceKind
  cursor?: string
  limit?: number
}>
export type BrowserMemoryArtifactDownloadRequest = MemoryArtifactDownloadRequest & Readonly<{ deliveryUrl?: string }>
export type BrowserMemoryExportStatus = Omit<MemoryExportStatus, "artifactDownloadRequest"> & Readonly<{
  artifactDownloadRequest: BrowserMemoryArtifactDownloadRequest | null
}>
export type BrowserMemoryExportResponse = Readonly<{ export: BrowserMemoryExportStatus }>

export class MemoryBrowserError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = "MemoryBrowserError"
  }
}

type RuntimeSchema<Value> = Readonly<{
  safeParse(input: unknown):
    | Readonly<{ success: true; data: Value }>
    | Readonly<{ success: false }>
}>

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
}

function protocol(): never {
  throw new MemoryBrowserError(502, "BFF_PROTOCOL_INVALID", "Memory response was invalid")
}

async function responseJson(response: Response): Promise<unknown> {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "application/json") protocol()
  let value: unknown
  try {
    value = await response.json() as unknown
  } catch {
    protocol()
  }
  if (response.ok) return value
  const error = record(record(value)?.error)
  const recovery = record(record(value)?.recovery)
  const code = typeof error?.code === "string" ? error.code : "MEMORY_UNAVAILABLE"
  const message = typeof error?.message === "string" ? error.message : "Memory is unavailable"
  if (code === "OUTCOME_UNKNOWN" && typeof recovery?.commandId === "string") {
    throw new MemoryBrowserError(response.status, code, `${message}:${recovery.commandId}`)
  }
  throw new MemoryBrowserError(response.status, code, message)
}

async function json<Value>(response: Response, schema: RuntimeSchema<Value>): Promise<Value> {
  const parsed = schema.safeParse(await responseJson(response))
  if (!parsed.success) protocol()
  return parsed.data
}

function encodedReference(schema: RuntimeSchema<string>, value: string): string {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new TypeError("invalid Memory reference")
  return encodeURIComponent(parsed.data)
}

function query(input: MemoryPageQuery): string {
  const value = new URLSearchParams()
  if (input.category !== undefined) value.set("category", input.category)
  if (input.source !== undefined) value.set("source", input.source)
  if (input.cursor !== undefined) value.set("cursor", input.cursor)
  if (input.limit !== undefined) value.set("limit", String(input.limit))
  const rendered = value.toString()
  return rendered === "" ? "" : `?${rendered}`
}

function historyQuery(input: Readonly<{ cursor?: string; limit?: number }>): string {
  return query(input)
}

function unique<Value>(items: readonly Value[], identity: (value: Value) => string): void {
  const refs = items.map(identity)
  if (new Set(refs).size !== refs.length) protocol()
}

function projectedExportResponse(value: unknown): BrowserMemoryExportResponse {
  const root = record(value)
  const rawExport = record(root?.export)
  const rawRequest = record(rawExport?.artifactDownloadRequest)
  const deliveryUrl = rawRequest?.deliveryUrl
  const sanitizedRequest = rawRequest === null ? rawExport?.artifactDownloadRequest : (() => {
    const request = { ...rawRequest }
    delete request.deliveryUrl
    return request
  })()
  const parsed = zMemoryExportResponse.safeParse(root === null || rawExport === null ? value : {
    ...root,
    export: { ...rawExport, artifactDownloadRequest: sanitizedRequest },
  })
  if (!parsed.success) protocol()
  if (deliveryUrl === undefined) return parsed.data
  const request = parsed.data.export.artifactDownloadRequest
  if (parsed.data.export.state !== "ready" || request === null || typeof deliveryUrl !== "string") protocol()
  const expected = `/api/media/artifacts/${encodeURIComponent(request.artifactRef)}/versions/${encodeURIComponent(request.artifactVersionRef)}/content?purpose=export&exportIntentRef=${encodeURIComponent(request.deliveryRequestRef)}`
  if (deliveryUrl !== expected) protocol()
  return Object.freeze({ export: Object.freeze({
    ...parsed.data.export,
    artifactDownloadRequest: Object.freeze({ ...request, deliveryUrl }),
  }) })
}

function bytes(length: number): Uint8Array {
  const output = new Uint8Array(length)
  globalThis.crypto.getRandomValues(output)
  return output
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function createMemoryCommandIdentity(): MemoryCommandIdentity {
  return Object.freeze({ commandId: hex(bytes(16)), idempotencyKey: hex(bytes(24)) })
}

function sameCommand(response: MemoryCommandResponse, commandId: string): MemoryCommandResponse {
  if (response.command.commandId !== commandId) protocol()
  return response
}

export function createMemoryBrowserClient(input: Readonly<{
  csrfToken: string
  fetch?: MemoryBrowserFetch
}>) {
  const fetcher = input.fetch ?? fetch
  const read = async <Value>(path: string, schema: RuntimeSchema<Value>, signal?: AbortSignal): Promise<Value> => json(
    await fetcher(`/api/memory${path}`, {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    }),
    schema,
  )
  const mutate = async <Value>(
    method: "PATCH" | "POST",
    path: string,
    command: MemoryCommandIdentity,
    body: unknown,
    schema: RuntimeSchema<Value>,
    signal?: AbortSignal,
  ): Promise<Value> => json(await fetcher(`/api/memory${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-kokoro-browser-csrf": input.csrfToken,
    },
    body: JSON.stringify({ command, input: body }),
    ...(signal === undefined ? {} : { signal }),
  }), schema)

  return Object.freeze({
    getSettings(signal?: AbortSignal) {
      return read("/settings", zMemorySettings, signal)
    },
    async updateSettings(body: MemorySettingsUpdateInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("PATCH", "/settings", command, body, zMemoryCommandResponse, signal), command.commandId)
    },
    async listEntries(input: MemoryPageQuery = {}, signal?: AbortSignal): Promise<MemoryEntryPage> {
      const page = await read(`/entries${query(input)}`, zMemoryEntryPage, signal)
      unique(page.items, ({ entryRef }) => entryRef)
      return page
    },
    async getEntry(entryRef: string, signal?: AbortSignal): Promise<MemoryEntryResponse> {
      const response = await read(`/entries/${encodedReference(zMemoryEntryRef, entryRef)}`, zMemoryEntryResponse, signal)
      if (response.entry.entryRef !== entryRef) protocol()
      return response
    },
    async listHistory(entryRef: string, input: Readonly<{ cursor?: string; limit?: number }> = {}, signal?: AbortSignal): Promise<MemoryEntryHistoryPage> {
      const page = await read(`/entries/${encodedReference(zMemoryEntryRef, entryRef)}/history${historyQuery(input)}`, zMemoryEntryHistoryPage, signal)
      unique(page.items, ({ revisionRef }) => revisionRef)
      return page
    },
    async remember(body: MemoryRememberInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", "/entries", command, body, zMemoryCommandResponse, signal), command.commandId)
    },
    async correct(entryRef: string, body: MemoryCorrectInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", `/entries/${encodedReference(zMemoryEntryRef, entryRef)}/correct`, command, body, zMemoryCommandResponse, signal), command.commandId)
    },
    async restore(entryRef: string, revisionRef: string, body: MemoryRestoreInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", `/entries/${encodedReference(zMemoryEntryRef, entryRef)}/history/${encodedReference(zMemoryRevisionRef, revisionRef)}/restore`, command, body, zMemoryCommandResponse, signal), command.commandId)
    },
    async prioritize(entryRef: string, body: MemoryPriorityInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", `/entries/${encodedReference(zMemoryEntryRef, entryRef)}/prioritize`, command, body, zMemoryCommandResponse, signal), command.commandId)
    },
    async deprioritize(entryRef: string, body: MemoryPriorityInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", `/entries/${encodedReference(zMemoryEntryRef, entryRef)}/deprioritize`, command, body, zMemoryCommandResponse, signal), command.commandId)
    },
    async forget(entryRef: string, body: MemoryForgetInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", `/entries/${encodedReference(zMemoryEntryRef, entryRef)}/forget`, command, body, zMemoryCommandResponse, signal), command.commandId)
    },
    async reset(body: MemoryResetInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", "/reset", command, body, zMemoryCommandResponse, signal), command.commandId)
    },
    async requestExport(body: MemoryExportInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", "/exports", command, body, zMemoryCommandResponse, signal), command.commandId)
    },
    async getExport(exportRef: string, signal?: AbortSignal): Promise<BrowserMemoryExportResponse> {
      const response = await fetcher(`/api/memory/exports/${encodedReference(zMemoryExportRef, exportRef)}`, {
        method: "GET",
        credentials: "same-origin",
        headers: { accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      })
      return projectedExportResponse(await responseJson(response))
    },
    async requestImport(body: MemoryImportInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", "/imports", command, body, zMemoryCommandResponse, signal), command.commandId)
    },
    getImport(importRef: string, signal?: AbortSignal): Promise<MemoryImportResponse> {
      return read(`/imports/${encodedReference(zMemoryImportRef, importRef)}`, zMemoryImportResponse, signal)
    },
    recover(commandId: string, signal?: AbortSignal) {
      return read(`/commands/${encodedReference({ safeParse: (value) => /^[0-9a-f]{32}$/u.test(String(value))
        ? { success: true as const, data: String(value) }
        : { success: false as const } }, commandId)}`, zMemoryCommandResponse, signal)
    },
  })
}

export type PendingMemoryCommand = Readonly<{
  commandId: string
  commandKind: MemoryCommandKind
  createdAt: string
  targetRef: string | null
}>

export type MemoryControllerState = Readonly<{
  generation: number
  settings: MemorySettings | null
  entries: readonly MemoryEntryActiveView[]
  nextCursor: string | null
  selectedEntryRef: string | null
  selectedEntry: MemoryEntryView | null
  history: readonly MemoryRevisionView[]
  historyNextCursor: string | null
  exports: readonly BrowserMemoryExportStatus[]
  imports: readonly MemoryImportStatus[]
  pendingCommands: readonly PendingMemoryCommand[]
}>

function sameSource(left: MemoryEntryActiveView, right: MemoryEntryActiveView): boolean {
  return left.source.safeLabel === right.source.safeLabel && left.source.sourceKind === right.source.sourceKind && left.source.state === right.source.state
}

function sameEntry(left: MemoryEntryActiveView, right: MemoryEntryActiveView): boolean {
  return (
    left.entryRef === right.entryRef && left.entryVersion === right.entryVersion && left.revision === right.revision &&
    left.currentRevisionRef === right.currentRevisionRef && left.category === right.category && left.content === right.content &&
    left.prioritized === right.prioritized && left.scopeKind === right.scopeKind && left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt && left.validFrom === right.validFrom && left.validTo === right.validTo && sameSource(left, right)
  )
}

export function mergeMemoryEntries(
  current: readonly MemoryEntryActiveView[],
  incoming: readonly MemoryEntryActiveView[],
): readonly MemoryEntryActiveView[] {
  const entries = new Map(current.map((item) => [item.entryRef, item]))
  for (const candidate of incoming) {
    const existing = entries.get(candidate.entryRef)
    if (existing === undefined) {
      entries.set(candidate.entryRef, candidate)
      continue
    }
    const currentVersion = BigInt(existing.entryVersion)
    const candidateVersion = BigInt(candidate.entryVersion)
    if (candidateVersion < currentVersion) continue
    if (candidateVersion === currentVersion) {
      if (!sameEntry(existing, candidate)) throw new TypeError("Memory entry owner version conflict")
      continue
    }
    if (candidate.revision < existing.revision) throw new TypeError("Memory entry revision regressed")
    entries.set(candidate.entryRef, candidate)
  }
  return Object.freeze([...entries.values()])
}

function sameRevision(left: MemoryRevisionView, right: MemoryRevisionView): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function mergeMemoryHistory(
  current: readonly MemoryRevisionView[],
  incoming: readonly MemoryRevisionView[],
): readonly MemoryRevisionView[] {
  const revisions = new Map(current.map((item) => [item.revisionRef, item]))
  for (const candidate of incoming) {
    const existing = revisions.get(candidate.revisionRef)
    if (existing !== undefined && !sameRevision(existing, candidate)) throw new TypeError("Memory revision conflict")
    revisions.set(candidate.revisionRef, candidate)
  }
  return Object.freeze([...revisions.values()].sort((left, right) => right.revision - left.revision))
}

export function beginMemorySelection(state: MemoryControllerState, entryRef: string): MemoryControllerState {
  return Object.freeze({
    ...state,
    generation: state.generation + 1,
    selectedEntryRef: entryRef,
    selectedEntry: null,
    history: Object.freeze([]),
    historyNextCursor: null,
  })
}

export function settleMemorySelection(
  state: MemoryControllerState,
  generation: number,
  selectedEntry: MemoryEntryView,
  history: readonly MemoryRevisionView[],
): MemoryControllerState {
  if (state.generation !== generation || state.selectedEntryRef !== selectedEntry.entryRef) return state
  return Object.freeze({ ...state, selectedEntry, history: mergeMemoryHistory([], history) })
}

function replaceExport(current: readonly BrowserMemoryExportStatus[], incoming: MemoryExportStatus): readonly BrowserMemoryExportStatus[] {
  return Object.freeze([incoming, ...current.filter(({ exportRef }) => exportRef !== incoming.exportRef)])
}

function replaceImport(current: readonly MemoryImportStatus[], incoming: MemoryImportStatus): readonly MemoryImportStatus[] {
  return Object.freeze([incoming, ...current.filter(({ importRef }) => importRef !== incoming.importRef)])
}

export function projectMemoryCommand(state: MemoryControllerState, response: MemoryCommandResponse): MemoryControllerState {
  if (response.state !== "succeeded") {
    return Object.freeze({
      ...state,
      pendingCommands: response.state === "rejected"
        ? state.pendingCommands.filter(({ commandId }) => commandId !== response.command.commandId)
        : state.pendingCommands,
    })
  }
  const base = { ...state, pendingCommands: state.pendingCommands.filter(({ commandId }) => commandId !== response.command.commandId) }
  switch (response.result.resultKind) {
    case "settings":
      return Object.freeze({ ...base, settings: response.result.settings })
    case "export":
      return Object.freeze({ ...base, exports: replaceExport(state.exports, response.result.export) })
    case "import":
      return Object.freeze({ ...base, imports: replaceImport(state.imports, response.result.import) })
    case "restored":
      return Object.freeze({
        ...base,
        entries: mergeMemoryEntries(state.entries, [response.result.entry]),
        selectedEntry: state.selectedEntryRef === response.result.entry.entryRef ? response.result.entry : state.selectedEntry,
      })
    case "entry": {
      const resultEntry = response.result.entry
      if (resultEntry.state !== "active") {
        return Object.freeze({
          ...base,
          entries: state.entries.filter(({ entryRef }) => entryRef !== resultEntry.entryRef),
          selectedEntry: state.selectedEntryRef === resultEntry.entryRef ? resultEntry : state.selectedEntry,
        })
      }
      return Object.freeze({
        ...base,
        entries: mergeMemoryEntries(state.entries, [resultEntry]),
        selectedEntry: state.selectedEntryRef === resultEntry.entryRef ? resultEntry : state.selectedEntry,
      })
    }
    case "purge": {
      const purge = response.result
      const purgeView: MemoryEntryView | null = purge.entryRef === null ? null : purge.purgeState === "purged"
        ? { entryRef: purge.entryRef, purgeReceiptRef: purge.purgeReceiptRef, purgedAt: purge.effectiveAt, state: "purged" }
        : { entryRef: purge.entryRef, purgeReceiptRef: purge.purgeReceiptRef, revokedAt: purge.effectiveAt, state: "revoked_purge_pending" }
      if (purge.purgeScope === "space") {
        return Object.freeze({ ...base, entries: Object.freeze([]), selectedEntry: null, history: Object.freeze([]) })
      }
      return Object.freeze({
        ...base,
        entries: state.entries.filter(({ entryRef }) => entryRef !== purge.entryRef),
        selectedEntry: state.selectedEntryRef === purge.entryRef ? purgeView : state.selectedEntry,
      })
    }
  }
}

export interface MemoryStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const MEMORY_COMMAND_RECOVERY_TTL_MS = 24 * 60 * 60 * 1_000

function pendingRecord(value: unknown): PendingMemoryCommand | null {
  const input = record(value)
  const commandKinds: readonly MemoryCommandKind[] = [
    "updateMemorySettings", "rememberMemoryEntry", "correctMemoryEntry", "restoreMemoryEntryRevision",
    "prioritizeMemoryEntry", "deprioritizeMemoryEntry", "forgetMemoryEntry", "resetMemorySpace",
    "requestMemoryExport", "requestMemoryImport",
  ]
  if (
    typeof input?.commandId !== "string" || !/^[0-9a-f]{32}$/u.test(input.commandId) ||
    typeof input.commandKind !== "string" || !commandKinds.includes(input.commandKind as MemoryCommandKind) || typeof input.createdAt !== "string" ||
    (input.targetRef !== null && typeof input.targetRef !== "string")
  ) return null
  const createdAt = Date.parse(input.createdAt)
  if (!Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== input.createdAt) return null
  return Object.freeze({
    commandId: input.commandId,
    commandKind: input.commandKind as MemoryCommandKind,
    createdAt: input.createdAt,
    targetRef: input.targetRef,
  })
}

export function createMemoryCommandJournal(input: Readonly<{
  storage: MemoryStorage
  scope: string
  now?: () => number
}>) {
  if (input.scope.trim() === "" || input.scope.length > 512) throw new TypeError("invalid Memory journal scope")
  const prefix = `kokoro.memory.command.v1:${encodeURIComponent(input.scope)}:`
  const now = input.now ?? Date.now
  const list = (): readonly PendingMemoryCommand[] => {
    const records: PendingMemoryCommand[] = []
    const current = now()
    const keys = Array.from({ length: input.storage.length }, (_, index) => input.storage.key(index))
      .filter((key): key is string => key?.startsWith(prefix) ?? false)
    for (const key of keys) {
      const raw = input.storage.getItem(key)
      let parsed: PendingMemoryCommand | null = null
      try {
        parsed = raw === null ? null : pendingRecord(JSON.parse(raw) as unknown)
      } catch {
        parsed = null
      }
      const age = parsed === null ? Number.NaN : current - Date.parse(parsed.createdAt)
      if (parsed === null || age < 0 || age > MEMORY_COMMAND_RECOVERY_TTL_MS || key !== `${prefix}${parsed.commandId}`) {
        if (input.storage.getItem(key) === raw) input.storage.removeItem(key)
      } else records.push(parsed)
    }
    return Object.freeze(records.sort((left, right) => left.createdAt.localeCompare(right.createdAt)))
  }
  return Object.freeze({
    list,
    remember(recordInput: PendingMemoryCommand) {
      const parsed = pendingRecord(recordInput)
      if (parsed === null) throw new TypeError("invalid Memory command record")
      const records = list()
      if (!records.some(({ commandId }) => commandId === parsed.commandId) && records.length >= 20) {
        throw new Error("Too many Memory commands require recovery")
      }
      input.storage.setItem(`${prefix}${parsed.commandId}`, JSON.stringify(parsed))
    },
    resolve(commandId: string) {
      input.storage.removeItem(`${prefix}${commandId}`)
    },
  })
}
