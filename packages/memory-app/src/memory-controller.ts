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
  MemoryOwnerSnapshot,
  MemoryArtifactDownloadRequest,
  MemoryExportInput,
  MemoryExportStatus,
  MemoryForgetInput,
  MemoryImportInput,
  MemoryImportResponse,
  MemoryImportStatus,
  MemoryPriorityInput,
  MemoryPurgeCommandResult,
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

type MemoryCommandExpectation = Readonly<{
  assetVersionRef?: string
  commandId: string
  commandKind: MemoryCommandKind
  restoredFromRevisionRef?: string
  targetRef: string | null
}>

function commandResultMatches(response: MemoryCommandResponse, expected: MemoryCommandExpectation): boolean {
  if (response.state !== "succeeded") return true
  const result = response.result
  switch (expected.commandKind) {
    case "updateMemorySettings":
      return expected.targetRef === null && result.resultKind === "settings"
    case "rememberMemoryEntry":
      return expected.targetRef === null && result.resultKind === "entry" && result.entry.state === "active"
    case "correctMemoryEntry":
      return result.resultKind === "entry" && result.entry.state === "active" && result.entry.entryRef === expected.targetRef
    case "prioritizeMemoryEntry":
      return result.resultKind === "entry" && result.entry.state === "active" && result.entry.entryRef === expected.targetRef && result.entry.prioritized
    case "deprioritizeMemoryEntry":
      return result.resultKind === "entry" && result.entry.state === "active" && result.entry.entryRef === expected.targetRef && !result.entry.prioritized
    case "restoreMemoryEntryRevision":
      return result.resultKind === "restored" && result.entry.entryRef === expected.targetRef &&
        result.restoredFromRevisionRef === expected.restoredFromRevisionRef
    case "forgetMemoryEntry":
      return result.resultKind === "purge" && result.purgeScope === "entry" && result.entryRef === expected.targetRef
    case "resetMemorySpace":
      return expected.targetRef === null && result.resultKind === "purge" && result.purgeScope === "space" && result.entryRef === null
    case "requestMemoryExport":
      return expected.targetRef === null && result.resultKind === "export"
    case "requestMemoryImport":
      return result.resultKind === "import" && result.import.assetRef === expected.targetRef &&
        result.import.assetVersionRef === expected.assetVersionRef
  }
}

function sameCommand(response: MemoryCommandResponse, expected: MemoryCommandExpectation): MemoryCommandResponse {
  if (
    response.command.commandId !== expected.commandId ||
    response.command.commandKind !== expected.commandKind ||
    !commandResultMatches(response, expected)
  ) protocol()
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
      return sameCommand(await mutate("PATCH", "/settings", command, body, zMemoryCommandResponse, signal), { ...command, commandKind: "updateMemorySettings", targetRef: null })
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
      if (page.entryRef !== entryRef) protocol()
      unique(page.items, ({ revisionRef }) => revisionRef)
      return page
    },
    async remember(body: MemoryRememberInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", "/entries", command, body, zMemoryCommandResponse, signal), { ...command, commandKind: "rememberMemoryEntry", targetRef: null })
    },
    async correct(entryRef: string, body: MemoryCorrectInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", `/entries/${encodedReference(zMemoryEntryRef, entryRef)}/correct`, command, body, zMemoryCommandResponse, signal), { ...command, commandKind: "correctMemoryEntry", targetRef: entryRef })
    },
    async restore(entryRef: string, revisionRef: string, body: MemoryRestoreInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", `/entries/${encodedReference(zMemoryEntryRef, entryRef)}/history/${encodedReference(zMemoryRevisionRef, revisionRef)}/restore`, command, body, zMemoryCommandResponse, signal), { ...command, commandKind: "restoreMemoryEntryRevision", restoredFromRevisionRef: revisionRef, targetRef: entryRef })
    },
    async prioritize(entryRef: string, body: MemoryPriorityInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", `/entries/${encodedReference(zMemoryEntryRef, entryRef)}/prioritize`, command, body, zMemoryCommandResponse, signal), { ...command, commandKind: "prioritizeMemoryEntry", targetRef: entryRef })
    },
    async deprioritize(entryRef: string, body: MemoryPriorityInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", `/entries/${encodedReference(zMemoryEntryRef, entryRef)}/deprioritize`, command, body, zMemoryCommandResponse, signal), { ...command, commandKind: "deprioritizeMemoryEntry", targetRef: entryRef })
    },
    async forget(entryRef: string, body: MemoryForgetInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", `/entries/${encodedReference(zMemoryEntryRef, entryRef)}/forget`, command, body, zMemoryCommandResponse, signal), { ...command, commandKind: "forgetMemoryEntry", targetRef: entryRef })
    },
    async reset(body: MemoryResetInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", "/reset", command, body, zMemoryCommandResponse, signal), { ...command, commandKind: "resetMemorySpace", targetRef: null })
    },
    async requestExport(body: MemoryExportInput, command = createMemoryCommandIdentity(), signal?: AbortSignal) {
      return sameCommand(await mutate("POST", "/exports", command, body, zMemoryCommandResponse, signal), { ...command, commandKind: "requestMemoryExport", targetRef: null })
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
      return sameCommand(await mutate("POST", "/imports", command, body, zMemoryCommandResponse, signal), { ...command, assetVersionRef: body.assetVersionRef, commandKind: "requestMemoryImport", targetRef: body.assetRef })
    },
    getImport(importRef: string, signal?: AbortSignal): Promise<MemoryImportResponse> {
      return read(`/imports/${encodedReference(zMemoryImportRef, importRef)}`, zMemoryImportResponse, signal)
    },
    async recover(expected: PendingMemoryCommand, signal?: AbortSignal) {
      const response = await read(`/commands/${encodedReference({ safeParse: (value) => /^[0-9a-f]{32}$/u.test(String(value))
        ? { success: true as const, data: String(value) }
        : { success: false as const } }, expected.commandId)}`, zMemoryCommandResponse, signal)
      return sameCommand(response, expected)
    },
  })
}

export type PendingMemoryCommand = Readonly<{
  assetVersionRef?: string
  commandId: string
  commandKind: MemoryCommandKind
  createdAt: string
  restoredFromRevisionRef?: string
  targetRef: string | null
}>

export type MemoryEntryOwnerKnowledge =
  | Readonly<{
    entryRef: string
    entryVersion: string
    state: "active"
  }>
  | Readonly<{
    entryRef: string
    state: "revoked"
  }>

export type MemorySpacePurgeView = Readonly<Pick<
  MemoryPurgeCommandResult,
  "effectiveAt" | "purgeReceiptRef" | "purgeState"
>>

export type MemoryControllerState = Readonly<{
  generation: number
  settings: MemorySettings | null
  entries: readonly MemoryEntryActiveView[]
  entryOwnerKnowledge: readonly MemoryEntryOwnerKnowledge[]
  currentOwnerSnapshot: MemoryOwnerSnapshot | null
  minimumSpaceVersion: string | null
  nextCursor: string | null
  selectedEntryRef: string | null
  selectedEntry: MemoryEntryView | null
  history: readonly MemoryRevisionView[]
  currentHistoryOwnerSnapshot: MemoryOwnerSnapshot | null
  historyNextCursor: string | null
  exports: readonly BrowserMemoryExportStatus[]
  imports: readonly MemoryImportStatus[]
  pendingCommands: readonly PendingMemoryCommand[]
  spacePurge: MemorySpacePurgeView | null
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

export type MemoryOwnerPageReconciliation = Readonly<{
  entries: readonly MemoryEntryActiveView[]
  entryOwnerKnowledge: readonly MemoryEntryOwnerKnowledge[]
  currentOwnerSnapshot: MemoryOwnerSnapshot
  minimumSpaceVersion: string
}>

export type MemoryOwnerPageMode = "continuation" | "first"

export type MemoryOwnerPageReconciliationInput = Readonly<{
  currentEntries: readonly MemoryEntryActiveView[]
  currentOwnerSnapshot: MemoryOwnerSnapshot | null
  incomingEntries: readonly MemoryEntryActiveView[]
  incomingOwnerSnapshot: MemoryOwnerSnapshot
  minimumSpaceVersion: string | null
  ownerKnowledge: readonly MemoryEntryOwnerKnowledge[]
  pageMode: MemoryOwnerPageMode
  retainEntryRefs: readonly string[]
}>

function maximumVersion(left: string | null, right: string): string {
  return left === null || BigInt(right) > BigInt(left) ? right : left
}

function sameOwnerSnapshot(left: MemoryOwnerSnapshot, right: MemoryOwnerSnapshot): boolean {
  return left.snapshotRef === right.snapshotRef && left.spaceVersion === right.spaceVersion
}

function compactOwnerKnowledge(
  current: readonly MemoryEntryOwnerKnowledge[],
  entries: readonly MemoryEntryActiveView[],
  retainEntryRefs: readonly string[],
): readonly MemoryEntryOwnerKnowledge[] {
  const retained = new Set(retainEntryRefs)
  const compacted = new Map<string, MemoryEntryOwnerKnowledge>()
  for (const item of current) {
    if (retained.has(item.entryRef)) compacted.set(item.entryRef, item)
  }
  for (const entry of entries) {
    const known = compacted.get(entry.entryRef)
    if (known?.state === "revoked") throw new TypeError("Memory entry owner lifecycle conflict")
    if (known?.state === "active" && BigInt(known.entryVersion) > BigInt(entry.entryVersion)) continue
    compacted.set(entry.entryRef, Object.freeze({
      entryRef: entry.entryRef,
      entryVersion: entry.entryVersion,
      state: "active",
    }))
  }
  return Object.freeze([...compacted.values()])
}

export function reconcileMemoryOwnerPage(
  input: MemoryOwnerPageReconciliationInput,
): MemoryOwnerPageReconciliation | null {
  if (
    input.minimumSpaceVersion !== null &&
    BigInt(input.incomingOwnerSnapshot.spaceVersion) < BigInt(input.minimumSpaceVersion)
  ) return null
  if (
    input.pageMode === "continuation" &&
    (input.currentOwnerSnapshot === null || !sameOwnerSnapshot(input.currentOwnerSnapshot, input.incomingOwnerSnapshot))
  ) return null

  const currentByRef = new Map(input.currentEntries.map((entry) => [entry.entryRef, entry]))
  const incomingByRef = new Map(input.incomingEntries.map((entry) => [entry.entryRef, entry]))
  for (const candidate of input.incomingEntries) {
    const existing = currentByRef.get(candidate.entryRef)
    if (existing !== undefined && BigInt(existing.entryVersion) > BigInt(candidate.entryVersion)) return null
  }
  for (const knowledge of input.ownerKnowledge) {
    const candidate = incomingByRef.get(knowledge.entryRef)
    if (knowledge.state === "revoked") {
      if (candidate !== undefined) return null
      continue
    }
    if (candidate !== undefined && BigInt(candidate.entryVersion) < BigInt(knowledge.entryVersion)) return null
  }
  const entries = input.pageMode === "continuation"
    ? mergeMemoryEntries(input.currentEntries, input.incomingEntries)
    : Object.freeze(input.incomingEntries.map((candidate) => {
      const existing = currentByRef.get(candidate.entryRef)
      return existing === undefined ? candidate : mergeMemoryEntries([existing], [candidate])[0] ?? candidate
    }))
  return Object.freeze({
    entries,
    entryOwnerKnowledge: compactOwnerKnowledge(input.ownerKnowledge, entries, input.retainEntryRefs),
    currentOwnerSnapshot: input.incomingOwnerSnapshot,
    minimumSpaceVersion: maximumVersion(input.minimumSpaceVersion, input.incomingOwnerSnapshot.spaceVersion),
  })
}

export function reconcileMemoryEntryPage(
  input: MemoryOwnerPageReconciliationInput,
): MemoryOwnerPageReconciliation | null {
  return reconcileMemoryOwnerPage(input)
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

export type MemoryHistoryPageMode = "continuation" | "first"

export type MemoryHistoryPageReconciliation = Readonly<{
  history: readonly MemoryRevisionView[]
  currentHistoryOwnerSnapshot: MemoryOwnerSnapshot
  minimumSpaceVersion: string
}>

export function reconcileMemoryHistoryPage(input: Readonly<{
  currentHistory: readonly MemoryRevisionView[]
  currentHistoryOwnerSnapshot: MemoryOwnerSnapshot | null
  incomingPage: MemoryEntryHistoryPage
  minimumSpaceVersion: string | null
  pageMode: MemoryHistoryPageMode
}>): MemoryHistoryPageReconciliation | null {
  if (
    input.minimumSpaceVersion !== null &&
    BigInt(input.incomingPage.ownerSnapshot.spaceVersion) < BigInt(input.minimumSpaceVersion)
  ) return null
  if (
    input.pageMode === "continuation" &&
    (input.currentHistoryOwnerSnapshot === null || !sameOwnerSnapshot(input.currentHistoryOwnerSnapshot, input.incomingPage.ownerSnapshot))
  ) return null
  return Object.freeze({
    history: input.pageMode === "continuation"
      ? mergeMemoryHistory(input.currentHistory, input.incomingPage.items)
      : mergeMemoryHistory([], input.incomingPage.items),
    currentHistoryOwnerSnapshot: input.incomingPage.ownerSnapshot,
    minimumSpaceVersion: maximumVersion(input.minimumSpaceVersion, input.incomingPage.ownerSnapshot.spaceVersion),
  })
}

export function beginMemorySelection(state: MemoryControllerState, entryRef: string): MemoryControllerState {
  return Object.freeze({
    ...state,
    generation: state.generation + 1,
    selectedEntryRef: entryRef,
    selectedEntry: null,
    history: Object.freeze([]),
    currentHistoryOwnerSnapshot: null,
    historyNextCursor: null,
  })
}

export function settleMemorySelection(
  state: MemoryControllerState,
  generation: number,
  response: MemoryEntryResponse,
  historyPage: MemoryEntryHistoryPage,
): MemoryControllerState {
  const selectedEntry = response.entry
  if (state.generation !== generation || state.selectedEntryRef !== selectedEntry.entryRef) return state
  if (historyPage.entryRef !== selectedEntry.entryRef) return state
  if (historyPage.ownerSnapshot.spaceVersion !== response.observedSpaceVersion) return state
  if (state.minimumSpaceVersion !== null && BigInt(response.observedSpaceVersion) < BigInt(state.minimumSpaceVersion)) return state
  const ownerVersionAdvanced = state.minimumSpaceVersion !== null &&
    BigInt(response.observedSpaceVersion) > BigInt(state.minimumSpaceVersion)
  const minimumSpaceVersion = maximumVersion(state.minimumSpaceVersion, response.observedSpaceVersion)
  const ownerSnapshotIsCurrent = !ownerVersionAdvanced && state.currentOwnerSnapshot !== null &&
    BigInt(state.currentOwnerSnapshot.spaceVersion) >= BigInt(response.observedSpaceVersion)
  if (selectedEntry.state === "active") {
    if (state.selectedEntry?.entryRef === selectedEntry.entryRef && state.selectedEntry.state !== "active") return state
    const knowledge = state.entryOwnerKnowledge.find(({ entryRef }) => entryRef === selectedEntry.entryRef)
    if (knowledge?.state === "revoked") return state
    const floor = currentActiveEntryFloor(state, selectedEntry.entryRef)
    const incomingVersion = BigInt(selectedEntry.entryVersion)
    if (knowledge?.state === "active" && incomingVersion < BigInt(knowledge.entryVersion)) return state
    if (floor !== null) {
      const floorVersion = BigInt(floor.entryVersion)
      if (incomingVersion < floorVersion) return state
      if (incomingVersion === floorVersion) mergeMemoryEntries([floor], [selectedEntry])
    }
    const listed = !ownerVersionAdvanced && state.entries.some(({ entryRef }) => entryRef === selectedEntry.entryRef)
    const entries = ownerVersionAdvanced
      ? Object.freeze([])
      : listed ? mergeMemoryEntries(state.entries, [selectedEntry]) : state.entries
    return Object.freeze({
      ...state,
      entries,
      entryOwnerKnowledge: compactOwnerKnowledge(
        advanceActiveOwnerKnowledge(state.entryOwnerKnowledge, selectedEntry),
        entries,
        [selectedEntry.entryRef],
      ),
      currentOwnerSnapshot: ownerSnapshotIsCurrent ? state.currentOwnerSnapshot : null,
      minimumSpaceVersion,
      nextCursor: ownerSnapshotIsCurrent ? state.nextCursor : null,
      selectedEntry,
      history: mergeMemoryHistory([], historyPage.items),
      currentHistoryOwnerSnapshot: historyPage.ownerSnapshot,
      historyNextCursor: historyPage.pageInfo.nextCursor,
    })
  }
  const entries = ownerVersionAdvanced
    ? Object.freeze([])
    : state.entries.filter(({ entryRef }) => entryRef !== selectedEntry.entryRef)
  return Object.freeze({
    ...state,
    entries,
    entryOwnerKnowledge: compactOwnerKnowledge(
      revokeOwnerKnowledge(state.entryOwnerKnowledge, [selectedEntry.entryRef]),
      entries,
      [selectedEntry.entryRef],
    ),
    currentOwnerSnapshot: null,
    minimumSpaceVersion,
    nextCursor: null,
    selectedEntry,
    history: mergeMemoryHistory([], historyPage.items),
    currentHistoryOwnerSnapshot: historyPage.ownerSnapshot,
    historyNextCursor: historyPage.pageInfo.nextCursor,
  })
}

export function projectMemoryReadEpoch(
  state: MemoryControllerState,
  expectedGeneration: number,
  project: (current: MemoryControllerState) => MemoryControllerState,
): MemoryControllerState {
  return state.generation === expectedGeneration ? project(state) : state
}

function exportProjection(value: BrowserMemoryExportStatus | MemoryExportStatus): unknown {
  const request = value.artifactDownloadRequest
  return {
    ...value,
    artifactDownloadRequest: request === null ? null : {
      artifactRef: request.artifactRef,
      artifactVersionRef: request.artifactVersionRef,
      deliveryRequestRef: request.deliveryRequestRef,
      purpose: request.purpose,
    },
  }
}

function sameProjection(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const EXPORT_REACHABLE_STATES: Readonly<Record<MemoryExportStatus["state"], readonly MemoryExportStatus["state"][]>> = {
  queued: ["queued", "running", "ready", "failed", "expired", "purged"],
  running: ["running", "ready", "failed", "expired", "purged"],
  ready: ["ready", "expired", "purged"],
  failed: ["failed", "purged"],
  expired: ["expired", "purged"],
  purged: ["purged"],
}

const IMPORT_REACHABLE_STATES: Readonly<Record<MemoryImportStatus["state"], readonly MemoryImportStatus["state"][]>> = {
  queued: ["queued", "validating", "quarantined", "applying", "completed", "rejected", "failed"],
  validating: ["validating", "quarantined", "applying", "completed", "rejected", "failed"],
  quarantined: ["quarantined", "applying", "completed", "rejected", "failed"],
  applying: ["applying", "completed", "rejected", "failed"],
  completed: ["completed"],
  rejected: ["rejected"],
  failed: ["failed"],
}

function replaceExport(current: readonly BrowserMemoryExportStatus[], incoming: MemoryExportStatus): readonly BrowserMemoryExportStatus[] {
  const existing = current.find(({ exportRef }) => exportRef === incoming.exportRef)
  if (existing !== undefined) {
    const comparison = BigInt(incoming.statusVersion) - BigInt(existing.statusVersion)
    if (comparison < 0n) return current
    if (comparison === 0n) {
      if (!sameProjection(exportProjection(existing), exportProjection(incoming))) throw new TypeError("Memory export status version conflict")
      return current
    }
    if (!EXPORT_REACHABLE_STATES[existing.state].includes(incoming.state)) throw new TypeError("Memory export state regressed")
  }
  return Object.freeze([incoming, ...current.filter(({ exportRef }) => exportRef !== incoming.exportRef)])
}

function replaceImport(current: readonly MemoryImportStatus[], incoming: MemoryImportStatus): readonly MemoryImportStatus[] {
  const existing = current.find(({ importRef }) => importRef === incoming.importRef)
  if (existing !== undefined) {
    const comparison = BigInt(incoming.statusVersion) - BigInt(existing.statusVersion)
    if (comparison < 0n) return current
    if (comparison === 0n) {
      if (!sameProjection(existing, incoming)) throw new TypeError("Memory import status version conflict")
      return current
    }
    if (!IMPORT_REACHABLE_STATES[existing.state].includes(incoming.state)) throw new TypeError("Memory import state regressed")
  }
  return Object.freeze([incoming, ...current.filter(({ importRef }) => importRef !== incoming.importRef)])
}

export function settleMemoryExportRefresh(
  state: MemoryControllerState,
  generation: number,
  incoming: BrowserMemoryExportStatus,
): MemoryControllerState {
  if (state.generation !== generation) return state
  const exports = replaceExport(state.exports, incoming)
  return exports === state.exports ? state : Object.freeze({ ...state, exports })
}

export function settleMemoryImportRefresh(
  state: MemoryControllerState,
  generation: number,
  incoming: MemoryImportStatus,
): MemoryControllerState {
  if (state.generation !== generation) return state
  const imports = replaceImport(state.imports, incoming)
  const accepted = imports.find(({ importRef }) => importRef === incoming.importRef)?.statusVersion === incoming.statusVersion
  if (!accepted || incoming.state !== "completed") return imports === state.imports ? state : Object.freeze({ ...state, imports })
  const resultingSpaceVersion = incoming.resultingSpaceVersion
  if (resultingSpaceVersion === null) throw new TypeError("Completed Memory import omitted its owner version")
  const advancesFloor = state.minimumSpaceVersion === null || BigInt(resultingSpaceVersion) > BigInt(state.minimumSpaceVersion)
  if (!advancesFloor) return imports === state.imports ? state : Object.freeze({ ...state, imports })
  return Object.freeze({
    ...state,
    generation: state.generation + 1,
    entries: Object.freeze([]),
    entryOwnerKnowledge: Object.freeze([]),
    currentOwnerSnapshot: null,
    minimumSpaceVersion: resultingSpaceVersion,
    nextCursor: null,
    selectedEntryRef: null,
    selectedEntry: null,
    history: Object.freeze([]),
    currentHistoryOwnerSnapshot: null,
    historyNextCursor: null,
    imports,
  })
}

function currentActiveEntryFloor(state: MemoryControllerState, entryRef: string): MemoryEntryActiveView | null {
  const listed = state.entries.find((entry) => entry.entryRef === entryRef) ?? null
  const selected = state.selectedEntry?.entryRef === entryRef && state.selectedEntry.state === "active"
    ? state.selectedEntry
    : null
  if (listed === null) return selected
  if (selected === null) return listed
  return mergeMemoryEntries([listed], [selected])[0] ?? listed
}

function projectSelectedActiveEntry(
  state: MemoryControllerState,
  incoming: MemoryEntryActiveView,
): MemoryEntryView | null {
  if (state.selectedEntryRef !== incoming.entryRef) return state.selectedEntry
  if (state.selectedEntry !== null && state.selectedEntry.state !== "active") return state.selectedEntry
  const floor = currentActiveEntryFloor(state, incoming.entryRef)
  return floor === null ? incoming : mergeMemoryEntries([floor], [incoming])[0] ?? floor
}

function advanceActiveOwnerKnowledge(
  current: readonly MemoryEntryOwnerKnowledge[],
  incoming: MemoryEntryActiveView,
): readonly MemoryEntryOwnerKnowledge[] {
  const knowledge = new Map(current.map((item) => [item.entryRef, item]))
  const existing = knowledge.get(incoming.entryRef)
  if (existing?.state === "revoked") throw new TypeError("Memory entry owner lifecycle conflict")
  if (existing?.state === "active" && BigInt(existing.entryVersion) > BigInt(incoming.entryVersion)) return current
  knowledge.set(incoming.entryRef, Object.freeze({
    entryRef: incoming.entryRef,
    entryVersion: incoming.entryVersion,
    state: "active",
  }))
  return Object.freeze([...knowledge.values()])
}

function revokeOwnerKnowledge(
  current: readonly MemoryEntryOwnerKnowledge[],
  entryRefs: readonly string[],
): readonly MemoryEntryOwnerKnowledge[] {
  const knowledge = new Map(current.map((item) => [item.entryRef, item]))
  for (const entryRef of entryRefs) {
    knowledge.set(entryRef, Object.freeze({ entryRef, state: "revoked" }))
  }
  return Object.freeze([...knowledge.values()])
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
  const awaitingSpacePurge = response.result.resultKind === "purge" &&
    response.result.purgeScope === "space" && response.result.purgeState === "revoked_purge_pending"
  const pendingCommands = awaitingSpacePurge
    ? state.pendingCommands
    : state.pendingCommands.filter(({ commandId }) => commandId !== response.command.commandId)
  if (
    state.minimumSpaceVersion !== null &&
    BigInt(response.committedSpaceVersion) < BigInt(state.minimumSpaceVersion)
  ) {
    const resolved = Object.freeze({ ...state, pendingCommands })
    if (response.result.resultKind === "export") {
      return settleMemoryExportRefresh(resolved, state.generation, response.result.export)
    }
    if (response.result.resultKind === "import") {
      return settleMemoryImportRefresh(resolved, state.generation, response.result.import)
    }
    return resolved
  }
  const ownerVersionAdvanced = state.minimumSpaceVersion !== null &&
    BigInt(response.committedSpaceVersion) > BigInt(state.minimumSpaceVersion)
  const base: MemoryControllerState = {
    ...state,
    generation: ownerVersionAdvanced ? state.generation + 1 : state.generation,
    entries: ownerVersionAdvanced ? Object.freeze([]) : state.entries,
    entryOwnerKnowledge: ownerVersionAdvanced ? Object.freeze([]) : state.entryOwnerKnowledge,
    currentOwnerSnapshot: state.currentOwnerSnapshot !== null &&
      BigInt(state.currentOwnerSnapshot.spaceVersion) >= BigInt(response.committedSpaceVersion)
      ? state.currentOwnerSnapshot
      : null,
    minimumSpaceVersion: maximumVersion(state.minimumSpaceVersion, response.committedSpaceVersion),
    nextCursor: state.currentOwnerSnapshot !== null &&
      BigInt(state.currentOwnerSnapshot.spaceVersion) >= BigInt(response.committedSpaceVersion)
      ? state.nextCursor
      : null,
    selectedEntryRef: ownerVersionAdvanced ? null : state.selectedEntryRef,
    selectedEntry: ownerVersionAdvanced ? null : state.selectedEntry,
    history: ownerVersionAdvanced ? Object.freeze([]) : state.history,
    currentHistoryOwnerSnapshot: ownerVersionAdvanced ? null : state.currentHistoryOwnerSnapshot,
    historyNextCursor: ownerVersionAdvanced ? null : state.historyNextCursor,
    pendingCommands,
  }
  switch (response.result.resultKind) {
    case "settings":
      return Object.freeze({ ...base, settings: response.result.settings })
    case "export":
      return settleMemoryExportRefresh(Object.freeze(base), base.generation, response.result.export)
    case "import":
      return settleMemoryImportRefresh(Object.freeze(base), base.generation, response.result.import)
    case "restored": {
      const resultEntry = response.result.entry
      const targetFloor = currentActiveEntryFloor(state, resultEntry.entryRef)
      const authorizedEntry = ownerVersionAdvanced || targetFloor === null
        ? resultEntry
        : mergeMemoryEntries([targetFloor], [resultEntry])[0] ?? resultEntry
      const entries = mergeMemoryEntries(base.entries, [authorizedEntry])
      const keepSelectedTarget = state.selectedEntryRef === resultEntry.entryRef
      return Object.freeze({
        ...base,
        generation: state.generation + 1,
        entries,
        entryOwnerKnowledge: compactOwnerKnowledge(
          advanceActiveOwnerKnowledge(base.entryOwnerKnowledge, authorizedEntry),
          entries,
          keepSelectedTarget ? [resultEntry.entryRef] : [],
        ),
        currentOwnerSnapshot: null,
        nextCursor: null,
        selectedEntryRef: ownerVersionAdvanced ? (keepSelectedTarget ? resultEntry.entryRef : null) : base.selectedEntryRef,
        selectedEntry: ownerVersionAdvanced
          ? keepSelectedTarget ? authorizedEntry : null
          : projectSelectedActiveEntry(state, authorizedEntry),
        history: Object.freeze([]),
        currentHistoryOwnerSnapshot: null,
        historyNextCursor: null,
      })
    }
    case "entry": {
      const resultEntry = response.result.entry
      const keepSelectedTarget = state.selectedEntryRef === resultEntry.entryRef
      if (resultEntry.state !== "active") {
        const entries = base.entries.filter(({ entryRef }) => entryRef !== resultEntry.entryRef)
        return Object.freeze({
          ...base,
          generation: state.generation + 1,
          entries,
          entryOwnerKnowledge: compactOwnerKnowledge(
            revokeOwnerKnowledge(base.entryOwnerKnowledge, [resultEntry.entryRef]),
            entries,
            [resultEntry.entryRef],
          ),
          currentOwnerSnapshot: null,
          nextCursor: null,
          selectedEntryRef: ownerVersionAdvanced ? (keepSelectedTarget ? resultEntry.entryRef : null) : base.selectedEntryRef,
          selectedEntry: keepSelectedTarget ? resultEntry : base.selectedEntry,
          history: keepSelectedTarget ? Object.freeze([]) : base.history,
          currentHistoryOwnerSnapshot: keepSelectedTarget ? null : base.currentHistoryOwnerSnapshot,
          historyNextCursor: keepSelectedTarget ? null : base.historyNextCursor,
        })
      }
      const targetFloor = currentActiveEntryFloor(state, resultEntry.entryRef)
      const authorizedEntry = ownerVersionAdvanced || targetFloor === null
        ? resultEntry
        : mergeMemoryEntries([targetFloor], [resultEntry])[0] ?? resultEntry
      const entries = mergeMemoryEntries(base.entries, [authorizedEntry])
      return Object.freeze({
        ...base,
        generation: state.generation + 1,
        entries,
        entryOwnerKnowledge: compactOwnerKnowledge(
          advanceActiveOwnerKnowledge(base.entryOwnerKnowledge, authorizedEntry),
          entries,
          keepSelectedTarget ? [resultEntry.entryRef] : [],
        ),
        currentOwnerSnapshot: null,
        nextCursor: null,
        selectedEntryRef: ownerVersionAdvanced ? (keepSelectedTarget ? resultEntry.entryRef : null) : base.selectedEntryRef,
        selectedEntry: ownerVersionAdvanced
          ? keepSelectedTarget ? authorizedEntry : null
          : projectSelectedActiveEntry(state, authorizedEntry),
        history: keepSelectedTarget ? Object.freeze([]) : base.history,
        currentHistoryOwnerSnapshot: keepSelectedTarget ? null : base.currentHistoryOwnerSnapshot,
        historyNextCursor: keepSelectedTarget ? null : base.historyNextCursor,
      })
    }
    case "purge": {
      const purge = response.result
      const purgeView: MemoryEntryView | null = purge.entryRef === null ? null : purge.purgeState === "purged"
        ? { entryRef: purge.entryRef, purgeReceiptRef: purge.purgeReceiptRef, purgedAt: purge.effectiveAt, state: "purged" }
        : { entryRef: purge.entryRef, purgeReceiptRef: purge.purgeReceiptRef, revokedAt: purge.effectiveAt, state: "revoked_purge_pending" }
      if (purge.purgeScope === "space") {
        return Object.freeze({
          ...base,
          generation: state.generation + 1,
          entries: Object.freeze([]),
          entryOwnerKnowledge: Object.freeze([]),
          currentOwnerSnapshot: null,
          nextCursor: null,
          selectedEntryRef: null,
          selectedEntry: null,
          history: Object.freeze([]),
          currentHistoryOwnerSnapshot: null,
          historyNextCursor: null,
          spacePurge: Object.freeze({
            effectiveAt: purge.effectiveAt,
            purgeReceiptRef: purge.purgeReceiptRef,
            purgeState: purge.purgeState,
          }),
        })
      }
      const entries = base.entries.filter(({ entryRef }) => entryRef !== purge.entryRef)
      const retainEntryRefs = purge.entryRef === null ? [] : [purge.entryRef]
      const keepSelectedTarget = state.selectedEntryRef === purge.entryRef
      return Object.freeze({
        ...base,
        generation: state.generation + 1,
        entries,
        entryOwnerKnowledge: compactOwnerKnowledge(
          purge.entryRef === null ? base.entryOwnerKnowledge : revokeOwnerKnowledge(base.entryOwnerKnowledge, [purge.entryRef]),
          entries,
          retainEntryRefs,
        ),
        currentOwnerSnapshot: null,
        nextCursor: null,
        selectedEntryRef: ownerVersionAdvanced ? (keepSelectedTarget ? purge.entryRef : null) : base.selectedEntryRef,
        selectedEntry: keepSelectedTarget ? purgeView : base.selectedEntry,
        history: keepSelectedTarget ? Object.freeze([]) : base.history,
        currentHistoryOwnerSnapshot: keepSelectedTarget ? null : base.currentHistoryOwnerSnapshot,
        historyNextCursor: keepSelectedTarget ? null : base.historyNextCursor,
      })
    }
  }
}

export function memorySpacePurgeIsPending(response: MemoryCommandResponse): boolean {
  return response.state === "succeeded" &&
    response.result.resultKind === "purge" &&
    response.result.purgeScope === "space" &&
    response.result.purgeState === "revoked_purge_pending"
}

export function memoryCommandRequiresRecovery(response: MemoryCommandResponse): boolean {
  if (response.state !== "succeeded") return response.state !== "rejected"
  return memorySpacePurgeIsPending(response)
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
  const base = {
    commandId: input.commandId,
    commandKind: input.commandKind as MemoryCommandKind,
    createdAt: input.createdAt,
    targetRef: input.targetRef,
  }
  const targetsNothing = ["updateMemorySettings", "rememberMemoryEntry", "resetMemorySpace", "requestMemoryExport"].includes(base.commandKind)
  if ((targetsNothing && base.targetRef !== null) || (!targetsNothing && typeof base.targetRef !== "string")) return null
  if (base.commandKind === "restoreMemoryEntryRevision") {
    if (typeof input.restoredFromRevisionRef !== "string" || input.restoredFromRevisionRef === "" || input.assetVersionRef !== undefined) return null
    return Object.freeze({ ...base, restoredFromRevisionRef: input.restoredFromRevisionRef })
  }
  if (base.commandKind === "requestMemoryImport") {
    if (typeof input.assetVersionRef !== "string" || input.assetVersionRef === "" || input.restoredFromRevisionRef !== undefined) return null
    return Object.freeze({ ...base, assetVersionRef: input.assetVersionRef })
  }
  if (input.assetVersionRef !== undefined || input.restoredFromRevisionRef !== undefined) return null
  return Object.freeze(base)
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
