import type {
  ArtifactAvailability,
  ArtifactPage,
  ArtifactResponse,
  ArtifactSummary,
  ArtifactVersion,
  ArtifactVersionPage,
  ArtifactVersionResponse,
  MediaDefinitionModelOptionPage,
  MediaOperationCommandResponse,
  MediaOperationDefinitionPage,
  MediaOperationDefinitionResponse,
  MediaOperationInput,
  MediaOperationPage,
  MediaOperationQuoteResponse,
  MediaOperationResponse,
} from "@kokoro/site-client"
import {
  mediaCallerRequestFingerprintSha256,
  zArtifactPage,
  zArtifactRef,
  zArtifactResponse,
  zArtifactVersionPage,
  zArtifactVersionRef,
  zArtifactVersionResponse,
  zCommandIdentity,
  zMediaDefinitionModelOptionPage,
  zMediaDefinitionRef,
  zMediaOperationCommandResponse,
  zMediaOperationDefinitionPage,
  zMediaOperationDefinitionResponse,
  zMediaOperationPage,
  zMediaOperationRef,
  zMediaOperationQuoteResponse,
  zMediaOperationResponse,
} from "@kokoro/site-client"

export type MediaCommandIdentity = Readonly<{ commandId: string; idempotencyKey: string }>
export type MediaPageQuery = Readonly<{ cursor?: string; limit?: number }>
export type MediaBrowserFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type BrowserArtifactSummary = ArtifactSummary & (
  | Readonly<{ availability: "ready"; contentUrl: string }>
  | Readonly<{ availability: Exclude<ArtifactAvailability, "ready">; contentUrl?: never }>
)
export type BrowserArtifactVersion =
  | (Extract<ArtifactVersion, { availability: "ready" }> & Readonly<{ contentUrl: string }>)
  | (Exclude<ArtifactVersion, { availability: "ready" }> & Readonly<{ contentUrl?: never }>)
export type BrowserArtifactPage = Omit<ArtifactPage, "items"> & Readonly<{ items: readonly BrowserArtifactSummary[] }>
export type BrowserArtifactVersionPage = Omit<ArtifactVersionPage, "items"> & Readonly<{ items: readonly BrowserArtifactVersion[] }>
export type BrowserArtifactResponse = Omit<ArtifactResponse, "artifact"> & Readonly<{ artifact: BrowserArtifactSummary }>
export type BrowserArtifactVersionResponse = Omit<ArtifactVersionResponse, "version"> & Readonly<{ version: BrowserArtifactVersion }>

export class MediaBrowserError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = "MediaBrowserError"
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
}

type RuntimeSchema<Value> = Readonly<{
  safeParse(input: unknown):
    | Readonly<{ success: true; data: Value }>
    | Readonly<{ success: false }>
}>

function protocol(): never {
  throw new MediaBrowserError(502, "BFF_PROTOCOL_INVALID", "Media response was invalid")
}

async function responseJson(response: Response): Promise<unknown> {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "application/json") throw new MediaBrowserError(502, "BFF_PROTOCOL_INVALID", "Media response was invalid")
  let value: unknown
  try {
    value = await response.json() as unknown
  } catch {
    protocol()
  }
  if (response.ok) return value
  const error = record(record(value)?.error)
  throw new MediaBrowserError(
    response.status,
    typeof error?.code === "string" ? error.code : "MEDIA_UNAVAILABLE",
    typeof error?.message === "string" ? error.message : "Media service is unavailable",
  )
}

async function json<Value>(response: Response, schema: RuntimeSchema<Value>): Promise<Value> {
  const parsed = schema.safeParse(await responseJson(response))
  if (!parsed.success) protocol()
  return parsed.data
}

function assertEqual(actual: string, expected: string): void {
  if (actual !== expected) protocol()
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) protocol()
}

function withoutContentUrl(value: unknown): unknown {
  const input = record(value)
  if (input === null) return value
  const output = { ...input }
  delete output.contentUrl
  return output
}

function contentUrl(value: unknown, artifactRef: string, artifactVersionRef: string, ready: boolean): string | undefined {
  const input = record(value)
  if (input === null) protocol()
  const candidate = input.contentUrl
  if (!ready) {
    if (candidate !== undefined) protocol()
    return undefined
  }
  if (typeof candidate !== "string") protocol()
  let parsed: URL
  try {
    parsed = new URL(candidate, "https://kokoro.invalid")
  } catch {
    protocol()
  }
  const expectedPath = `/api/media/artifacts/${encodeURIComponent(artifactRef)}/versions/${encodeURIComponent(artifactVersionRef)}/content`
  if (
    parsed.origin !== "https://kokoro.invalid" || parsed.username !== "" || parsed.password !== "" ||
    parsed.pathname !== expectedPath || parsed.search !== "?purpose=preview&viewport=thumbnail" || parsed.hash !== "" ||
    candidate !== `${expectedPath}?purpose=preview&viewport=thumbnail`
  ) protocol()
  return candidate
}

function artifactPage(value: unknown): BrowserArtifactPage {
  const raw = record(value)
  if (raw === null || !Array.isArray(raw.items)) protocol()
  const rawItems = raw.items
  const parsed = zArtifactPage.safeParse({ ...raw, items: rawItems.map(withoutContentUrl) })
  if (!parsed.success) protocol()
  assertUnique(parsed.data.items.map(({ artifactRef }) => artifactRef))
  return Object.freeze({
    ...parsed.data,
    items: Object.freeze(parsed.data.items.map((artifact, index) => Object.freeze({
      ...artifact,
      ...(contentUrl(rawItems[index], artifact.artifactRef, artifact.currentArtifactVersionRef, artifact.availability === "ready") === undefined
        ? {}
        : { contentUrl: (rawItems[index] as Readonly<Record<string, unknown>>).contentUrl as string }),
    }))) as readonly BrowserArtifactSummary[],
  })
}

function artifactResponse(value: unknown): BrowserArtifactResponse {
  const raw = record(value)
  const rawArtifact = raw?.artifact
  const parsed = zArtifactResponse.safeParse(raw === null ? value : { ...raw, artifact: withoutContentUrl(rawArtifact) })
  if (!parsed.success) protocol()
  const url = contentUrl(rawArtifact, parsed.data.artifact.artifactRef, parsed.data.artifact.currentArtifactVersionRef, parsed.data.artifact.availability === "ready")
  return Object.freeze({ artifact: Object.freeze({ ...parsed.data.artifact, ...(url === undefined ? {} : { contentUrl: url }) }) as BrowserArtifactSummary })
}

function artifactVersionPage(value: unknown, expectedArtifactRef: string): BrowserArtifactVersionPage {
  const raw = record(value)
  if (raw === null || !Array.isArray(raw.items)) protocol()
  const rawItems = raw.items
  const parsed = zArtifactVersionPage.safeParse({ ...raw, items: rawItems.map(withoutContentUrl) })
  if (!parsed.success) protocol()
  assertUnique(parsed.data.items.map(({ artifactVersionRef }) => artifactVersionRef))
  return Object.freeze({
    ...parsed.data,
    items: Object.freeze(parsed.data.items.map((version, index) => {
      assertEqual(version.artifactRef, expectedArtifactRef)
      const url = contentUrl(rawItems[index], version.artifactRef, version.artifactVersionRef, version.availability === "ready")
      return Object.freeze({ ...version, ...(url === undefined ? {} : { contentUrl: url }) }) as BrowserArtifactVersion
    })),
  })
}

function artifactVersionResponse(value: unknown, expectedArtifactRef: string, expectedVersionRef: string): BrowserArtifactVersionResponse {
  const raw = record(value)
  const rawVersion = raw?.version
  const parsed = zArtifactVersionResponse.safeParse(raw === null ? value : { ...raw, version: withoutContentUrl(rawVersion) })
  if (!parsed.success) protocol()
  assertEqual(parsed.data.version.artifactRef, expectedArtifactRef)
  assertEqual(parsed.data.version.artifactVersionRef, expectedVersionRef)
  const url = contentUrl(rawVersion, expectedArtifactRef, expectedVersionRef, parsed.data.version.availability === "ready")
  return Object.freeze({ version: Object.freeze({ ...parsed.data.version, ...(url === undefined ? {} : { contentUrl: url }) }) as BrowserArtifactVersion })
}

function query(input: MediaPageQuery): string {
  const value = new URLSearchParams()
  if (input.cursor !== undefined) value.set("cursor", input.cursor)
  if (input.limit !== undefined) value.set("limit", String(input.limit))
  const rendered = value.toString()
  return rendered === "" ? "" : `?${rendered}`
}

function commandResponse(
  response: MediaOperationCommandResponse,
  expectedCommandId: string,
  expectedOperationRef?: string,
  expectation?: MediaCommandRecoveryExpectation,
): MediaOperationCommandResponse {
  assertEqual(response.receipt.commandId, expectedCommandId)
  if (expectation?.kind === "submit") {
    if (!response.receipt.receiptKind.startsWith("submit_") || !("callerRequestFingerprint" in response.receipt)) protocol()
    assertEqual(response.receipt.callerRequestFingerprint, expectation.callerRequestFingerprint)
  } else if (expectation?.kind === "cancel" && !response.receipt.receiptKind.startsWith("cancel_")) {
    protocol()
  }
  if ("operationRef" in response.receipt && expectedOperationRef !== undefined) {
    assertEqual(response.receipt.operationRef, expectedOperationRef)
  }
  if (response.operation !== null) {
    if (!("operationRef" in response.receipt)) protocol()
    assertEqual(response.operation.operationRef, response.receipt.operationRef)
    if (expectedOperationRef !== undefined) assertEqual(response.operation.operationRef, expectedOperationRef)
  }
  return response
}

function reference(schema: RuntimeSchema<unknown>, value: string): string {
  if (!schema.safeParse(value).success) throw new TypeError("invalid media reference")
  return encodeURIComponent(value)
}

export function createMediaBrowserClient(input: Readonly<{
  fetch?: MediaBrowserFetch
  csrfToken: string
}>) {
  const fetcher = input.fetch ?? fetch
  const read = async <ResponseType>(path: string, schema: RuntimeSchema<ResponseType>, signal?: AbortSignal): Promise<ResponseType> => json(await fetcher(`/api/media${path}`, {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  }), schema)
  const readProjected = async (path: string, signal?: AbortSignal): Promise<unknown> => responseJson(await fetcher(`/api/media${path}`, {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  }))
  const control = async <ResponseType>(path: string, body: unknown, schema: RuntimeSchema<ResponseType>, signal?: AbortSignal): Promise<ResponseType> => json(await fetcher(`/api/media${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-kokoro-browser-csrf": input.csrfToken,
    },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  }), schema)
  return Object.freeze({
    async listDefinitions(page: MediaPageQuery, signal?: AbortSignal): Promise<MediaOperationDefinitionPage> {
      const response = await read(`/definitions${query(page)}`, zMediaOperationDefinitionPage, signal)
      assertUnique(response.items.map(({ definitionRef }) => definitionRef))
      return response
    },
    async getDefinition(definitionRef: string, signal?: AbortSignal): Promise<MediaOperationDefinitionResponse> {
      const response = await read(`/definitions/${reference(zMediaDefinitionRef, definitionRef)}`, zMediaOperationDefinitionResponse, signal)
      assertEqual(response.definition.definitionRef, definitionRef)
      return response
    },
    async listModelOptions(definitionRef: string, expectedDefinitionRevisionRef: string, page: MediaPageQuery, signal?: AbortSignal): Promise<MediaDefinitionModelOptionPage> {
      const response = await read(`/definitions/${reference(zMediaDefinitionRef, definitionRef)}/model-options${query(page)}`, zMediaDefinitionModelOptionPage, signal)
      assertEqual(response.definitionRevisionRef, expectedDefinitionRevisionRef)
      assertUnique(response.items.map(({ modelOptionRevisionRef }) => modelOptionRevisionRef))
      return response
    },
    async quote(operationInput: MediaOperationInput, command: MediaCommandIdentity, signal?: AbortSignal): Promise<MediaOperationQuoteResponse> {
      const response = await control("/quotes", { command, input: operationInput }, zMediaOperationQuoteResponse, signal)
      assertEqual(response.quote.definitionRevisionRef, operationInput.definitionRevisionRef)
      assertEqual(response.quote.modelOptionRevisionRef, operationInput.modelOptionRevisionRef)
      return response
    },
    async listOperations(page: MediaPageQuery, signal?: AbortSignal): Promise<MediaOperationPage> {
      const response = await read(`/operations${query(page)}`, zMediaOperationPage, signal)
      assertUnique(response.items.map(({ operationRef }) => operationRef))
      return response
    },
    async submit(operationInput: MediaOperationInput, command: MediaCommandIdentity, signal?: AbortSignal): Promise<MediaOperationCommandResponse> {
      const callerRequestFingerprint = await mediaCallerRequestFingerprintSha256({ contractMajor: 1, ...operationInput })
      const response = await control("/operations", { command, input: operationInput }, zMediaOperationCommandResponse, signal)
      return commandResponse(response, command.commandId, undefined, { kind: "submit", callerRequestFingerprint })
    },
    async getOperation(operationRef: string, signal?: AbortSignal): Promise<MediaOperationResponse> {
      const response = await read(`/operations/${reference(zMediaOperationRef, operationRef)}`, zMediaOperationResponse, signal)
      assertEqual(response.operation.operationRef, operationRef)
      return response
    },
    async cancel(
      operationRef: string,
      cancellation: Readonly<{ expectedOwnerVersion: string; reason?: string }>,
      command: MediaCommandIdentity,
      signal?: AbortSignal,
    ): Promise<MediaOperationCommandResponse> {
      const response = await control(`/operations/${reference(zMediaOperationRef, operationRef)}/cancel`, { command, ...cancellation }, zMediaOperationCommandResponse, signal)
      return commandResponse(response, command.commandId, operationRef, { kind: "cancel", operationRef })
    },
    async recoverCommand(commandId: string, expectation: MediaCommandRecoveryExpectation, signal?: AbortSignal): Promise<MediaOperationCommandResponse> {
      const response = await read(`/commands/${reference(zCommandIdentity, commandId)}`, zMediaOperationCommandResponse, signal)
      return commandResponse(response, commandId, expectation?.kind === "cancel" ? expectation.operationRef : undefined, expectation)
    },
    async listArtifacts(page: MediaPageQuery, signal?: AbortSignal): Promise<BrowserArtifactPage> {
      return artifactPage(await readProjected(`/artifacts${query(page)}`, signal))
    },
    async getArtifact(artifactRef: string, signal?: AbortSignal): Promise<BrowserArtifactResponse> {
      const response = artifactResponse(await readProjected(`/artifacts/${reference(zArtifactRef, artifactRef)}`, signal))
      assertEqual(response.artifact.artifactRef, artifactRef)
      return response
    },
    async listArtifactVersions(artifactRef: string, page: MediaPageQuery, signal?: AbortSignal): Promise<BrowserArtifactVersionPage> {
      return artifactVersionPage(await readProjected(`/artifacts/${reference(zArtifactRef, artifactRef)}/versions${query(page)}`, signal), artifactRef)
    },
    async getArtifactVersion(artifactRef: string, artifactVersionRef: string, signal?: AbortSignal): Promise<BrowserArtifactVersionResponse> {
      return artifactVersionResponse(await readProjected(`/artifacts/${reference(zArtifactRef, artifactRef)}/versions/${reference(zArtifactVersionRef, artifactVersionRef)}`, signal), artifactRef, artifactVersionRef)
    },
  })
}

function random(length: number): Uint8Array {
  const output = new Uint8Array(length)
  crypto.getRandomValues(output)
  return output
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function createMediaCommandIdentity(randomBytes: (length: number) => Uint8Array = random): MediaCommandIdentity {
  return Object.freeze({ commandId: hex(randomBytes(16)), idempotencyKey: hex(randomBytes(24)) })
}

export type MediaCommandRecoveryExpectation =
  | Readonly<{ kind: "submit"; callerRequestFingerprint: string }>
  | Readonly<{ kind: "cancel"; operationRef: string }>

export type MediaCommandRecoveryRecord = Readonly<{
  command: MediaCommandIdentity
  createdAt: string
}> & MediaCommandRecoveryExpectation

export interface MediaCommandStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const MEDIA_COMMAND_RECOVERY_TTL_MS = 24 * 60 * 60 * 1_000

export class MediaCommandRecoveryStorageError extends Error {
  readonly code = "MEDIA_RECOVERY_STORAGE_UNAVAILABLE" as const
  constructor(options?: ErrorOptions) {
    super("Command recovery storage is unavailable. Enable Site storage and retry.", options)
    this.name = "MediaCommandRecoveryStorageError"
  }
}

export class MediaCommandRecoveryCapacityError extends Error {
  readonly code = "MEDIA_RECOVERY_CAPACITY_REACHED" as const
  constructor() {
    super("Too many media commands still need reconciliation. Wait for recovery before creating another operation.")
    this.name = "MediaCommandRecoveryCapacityError"
  }
}

function recoveryRecord(value: unknown): MediaCommandRecoveryRecord | null {
  const input = record(value)
  const command = record(input?.command)
  if (
    (input?.kind !== "submit" && input?.kind !== "cancel") || typeof input.createdAt !== "string" ||
    typeof command?.commandId !== "string" || !/^[0-9a-f]{32}$/u.test(command.commandId) ||
    typeof command.idempotencyKey !== "string" || !/^\S{16,191}$/u.test(command.idempotencyKey)
  ) return null
  const createdAt = Date.parse(input.createdAt)
  if (!Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== input.createdAt) return null
  const expectation = input.kind === "submit"
    ? (typeof input.callerRequestFingerprint === "string" && /^[0-9a-f]{64}$/u.test(input.callerRequestFingerprint)
      ? { kind: input.kind, callerRequestFingerprint: input.callerRequestFingerprint } as const
      : null)
    : (typeof input.operationRef === "string" && zMediaOperationRef.safeParse(input.operationRef).success
      ? { kind: input.kind, operationRef: input.operationRef } as const
      : null)
  if (expectation === null) return null
  return Object.freeze({
    ...expectation,
    command: Object.freeze({ commandId: command.commandId, idempotencyKey: command.idempotencyKey }),
    createdAt: input.createdAt,
  })
}

export function createMediaCommandRecoveryStore(input: Readonly<{
  storage: MediaCommandStorage
  scope: string
  now?: () => number
}>) {
  const prefix = `kokoro.media.command.v2:${encodeURIComponent(input.scope)}:`
  const now = input.now ?? Date.now
  const storage = <Value>(operation: () => Value): Value => {
    try {
      return operation()
    } catch (cause) {
      throw new MediaCommandRecoveryStorageError({ cause })
    }
  }
  const list = (): readonly MediaCommandRecoveryRecord[] => {
    const keys = storage(() => Array.from({ length: input.storage.length }, (_, index) => input.storage.key(index))
      .filter((candidate): candidate is string => candidate?.startsWith(prefix) ?? false))
    const current = now()
    const records: MediaCommandRecoveryRecord[] = []
    for (const key of keys) {
      const raw = storage(() => input.storage.getItem(key))
      let parsed: MediaCommandRecoveryRecord | null = null
      try {
        parsed = raw === null ? null : recoveryRecord(JSON.parse(raw) as unknown)
      } catch {
        parsed = null
      }
      const age = parsed === null ? Number.NaN : current - Date.parse(parsed.createdAt)
      if (
        parsed === null || age < 0 || age > MEDIA_COMMAND_RECOVERY_TTL_MS ||
        key !== `${prefix}${parsed.command.commandId}`
      ) {
        storage(() => {
          // Do not delete a record another tab repaired after this tab read it.
          if (input.storage.getItem(key) === raw) input.storage.removeItem(key)
        })
      } else {
        records.push(parsed)
      }
    }
    records.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.command.commandId.localeCompare(right.command.commandId))
    return Object.freeze(records)
  }
  return Object.freeze({
    list,
    remember(recordInput: MediaCommandRecoveryRecord) {
      const valid = recoveryRecord(recordInput)
      if (valid === null) throw new TypeError("invalid media recovery record")
      const key = `${prefix}${valid.command.commandId}`
      const existing = list()
      if (!existing.some(({ command }) => command.commandId === valid.command.commandId) && existing.length >= 20) {
        throw new MediaCommandRecoveryCapacityError()
      }
      storage(() => input.storage.setItem(key, JSON.stringify(valid)))
    },
    forget(commandId: string) {
      storage(() => input.storage.removeItem(`${prefix}${commandId}`))
    },
  })
}
