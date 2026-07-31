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

async function json(response: Response): Promise<unknown> {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "application/json") throw new MediaBrowserError(502, "BFF_PROTOCOL_INVALID", "Media response was invalid")
  const value = await response.json() as unknown
  if (response.ok) {
    if (record(value) === null) throw new MediaBrowserError(502, "BFF_PROTOCOL_INVALID", "Media response was invalid")
    return value
  }
  const error = record(record(value)?.error)
  throw new MediaBrowserError(
    response.status,
    typeof error?.code === "string" ? error.code : "MEDIA_UNAVAILABLE",
    typeof error?.message === "string" ? error.message : "Media service is unavailable",
  )
}

function query(input: MediaPageQuery): string {
  const value = new URLSearchParams()
  if (input.cursor !== undefined) value.set("cursor", input.cursor)
  if (input.limit !== undefined) value.set("limit", String(input.limit))
  const rendered = value.toString()
  return rendered === "" ? "" : `?${rendered}`
}

function reference(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{2,255}$/u.test(value)) throw new TypeError("invalid media reference")
  return encodeURIComponent(value)
}

export function createMediaBrowserClient(input: Readonly<{
  fetch?: MediaBrowserFetch
  csrfToken: string
}>) {
  const fetcher = input.fetch ?? fetch
  const read = async <ResponseType>(path: string, signal?: AbortSignal): Promise<ResponseType> => json(await fetcher(`/api/media${path}`, {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  })) as Promise<ResponseType>
  const control = async <ResponseType>(path: string, body: unknown): Promise<ResponseType> => json(await fetcher(`/api/media${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-kokoro-browser-csrf": input.csrfToken,
    },
    body: JSON.stringify(body),
  })) as Promise<ResponseType>
  return Object.freeze({
    listDefinitions: (page: MediaPageQuery): Promise<MediaOperationDefinitionPage> => read(`/definitions${query(page)}`),
    getDefinition: (definitionRef: string): Promise<MediaOperationDefinitionResponse> => read(`/definitions/${reference(definitionRef)}`),
    listModelOptions: (definitionRef: string, page: MediaPageQuery): Promise<MediaDefinitionModelOptionPage> => read(`/definitions/${reference(definitionRef)}/model-options${query(page)}`),
    quote: (operationInput: MediaOperationInput, command: MediaCommandIdentity): Promise<MediaOperationQuoteResponse> => control("/quotes", { command, input: operationInput }),
    listOperations: (page: MediaPageQuery): Promise<MediaOperationPage> => read(`/operations${query(page)}`),
    submit: (operationInput: MediaOperationInput, command: MediaCommandIdentity): Promise<MediaOperationCommandResponse> => control("/operations", { command, input: operationInput }),
    getOperation: (operationRef: string, signal?: AbortSignal): Promise<MediaOperationResponse> => read(`/operations/${reference(operationRef)}`, signal),
    cancel: (
      operationRef: string,
      cancellation: Readonly<{ expectedOwnerVersion: string; reason?: string }>,
      command: MediaCommandIdentity,
    ): Promise<MediaOperationCommandResponse> => control(`/operations/${reference(operationRef)}/cancel`, { command, ...cancellation }),
    recoverCommand: (commandId: string, signal?: AbortSignal): Promise<MediaOperationCommandResponse> => read(`/commands/${reference(commandId)}`, signal),
    listArtifacts: (page: MediaPageQuery): Promise<BrowserArtifactPage> => read(`/artifacts${query(page)}`),
    getArtifact: (artifactRef: string): Promise<BrowserArtifactResponse> => read(`/artifacts/${reference(artifactRef)}`),
    listArtifactVersions: (artifactRef: string, page: MediaPageQuery): Promise<BrowserArtifactVersionPage> => read(`/artifacts/${reference(artifactRef)}/versions${query(page)}`),
    getArtifactVersion: (artifactRef: string, artifactVersionRef: string): Promise<BrowserArtifactVersionResponse> => read(`/artifacts/${reference(artifactRef)}/versions/${reference(artifactVersionRef)}`),
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

export type MediaCommandRecoveryRecord = Readonly<{
  kind: "submit" | "cancel"
  command: MediaCommandIdentity
  createdAt: string
}>

export interface MediaCommandStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function recoveryRecord(value: unknown): MediaCommandRecoveryRecord | null {
  const input = record(value)
  const command = record(input?.command)
  if (
    (input?.kind !== "submit" && input?.kind !== "cancel") || typeof input.createdAt !== "string" ||
    typeof command?.commandId !== "string" || !/^[0-9a-f]{32}$/u.test(command.commandId) ||
    typeof command.idempotencyKey !== "string" || !/^\S{16,191}$/u.test(command.idempotencyKey)
  ) return null
  return Object.freeze({
    kind: input.kind,
    command: Object.freeze({ commandId: command.commandId, idempotencyKey: command.idempotencyKey }),
    createdAt: input.createdAt,
  })
}

export function createMediaCommandRecoveryStore(input: Readonly<{
  storage: MediaCommandStorage
  scope: string
}>) {
  const key = `kokoro.media.commands.v1:${encodeURIComponent(input.scope)}`
  const list = (): readonly MediaCommandRecoveryRecord[] => {
    const raw = input.storage.getItem(key)
    if (raw === null) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return Object.freeze(parsed.slice(-20).map(recoveryRecord).filter((item): item is MediaCommandRecoveryRecord => item !== null))
    } catch {
      return []
    }
  }
  const write = (records: readonly MediaCommandRecoveryRecord[]) => {
    if (records.length === 0) input.storage.removeItem(key)
    else input.storage.setItem(key, JSON.stringify(records.slice(-20)))
  }
  return Object.freeze({
    list,
    remember(recordInput: MediaCommandRecoveryRecord) {
      const valid = recoveryRecord(recordInput)
      if (valid === null) throw new TypeError("invalid media recovery record")
      write([...list().filter(({ command }) => command.commandId !== valid.command.commandId), valid])
    },
    forget(commandId: string) {
      write(list().filter(({ command }) => command.commandId !== commandId))
    },
  })
}
