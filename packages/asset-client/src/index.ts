import {
  ASSET_DATA_PLANE_OPERATIONS,
  type ErrorResponse as DataPlaneErrorResponse,
  type MultipartPart,
  type MultipartPartResponse,
  type MultipartUploadStateResponse,
} from "@kokoro/site-client/asset-data-plane"

export const DEFAULT_MAXIMUM_BROWSER_ASSET_BYTES = 32 * 1024 * 1024

export type AssetAttachmentRef = Readonly<{
  asset_ref: string
  asset_version_ref: string
  asset_grant_ref: string
}>

export type AssetUploadProgress = Readonly<{
  phase: "hashing" | "authorizing" | "uploading" | "verifying" | "processing" | "ready"
  uploadedBytes: number
  totalBytes: number
}>

type Command = Readonly<{ commandId: string; idempotencyKey: string }>
type OwnerUpload = Readonly<{
  intentRef: string
  sessionRef: string
  expectedVersion: string
  stage: "upload_interrupted" | "uploading" | "upload_verification" | "scan_waiting" | "scanning" |
    "promotion_recovering" | "ready" | "rejected" | "aborted"
  terminal: boolean
  retryClass: "never" | "immediate" | "after_delay" | "after_user_action"
  retryAfter: string | null
  safeReasonCode: string | null
  attachment: AssetAttachmentRef | null
}>
type Capability = Readonly<{
  credential: string
  expiresAt: string
  maximumPartBytes: string
  minimumPartBytes: string
  protocolRevision: "s3-multipart-v1"
  uploadEndpoint: string
}>
type OwnerCreateResponse = Readonly<{ capability: Capability; upload: OwnerUpload }>

export type AssetRecoveryRecord = Readonly<{
  schemaVersion: 1
  fingerprint: string
  filename: string
  mediaType: string
  size: number
  checksumSha256: string
  purpose: string
  ownerCreate: Command
  clientUploadId: string
  initiateIdempotencyKey: string
  partIdempotencyKeys: Readonly<Record<string, string>>
  dataCompleteIdempotencyKey: string
  dataCompleteExpectedVersion: string | null
  ownerComplete: Command
  owner: Readonly<{ intentRef: string; sessionRef: string; expectedVersion: string }> | null
}>

export interface AssetRecoveryStore {
  get(fingerprint: string): Promise<AssetRecoveryRecord | null> | AssetRecoveryRecord | null
  put(record: AssetRecoveryRecord): Promise<void> | void
  delete(fingerprint: string): Promise<void> | void
}

export class AssetUploadError extends Error {
  constructor(
    readonly code: "FILE_INVALID" | "FILE_TOO_LARGE" | "CONTROL_REJECTED" | "CAPABILITY_REJECTED" |
      "UPLOAD_REJECTED" | "UPLOAD_UNAVAILABLE" | "PROCESSING_REJECTED" | "PROCESSING_TIMEOUT",
    message: string,
  ) {
    super(message)
    this.name = "AssetUploadError"
  }
}

export function createLocalAssetRecoveryStore(options: Readonly<{
  storage?: Storage
  scope?: string
  pruneOtherScopes?: boolean
}> = {}): AssetRecoveryStore {
  const storage = options.storage ?? globalThis.localStorage
  const root = "kokoro.asset-upload.v1."
  const scope = encodeURIComponent(options.scope ?? "default")
  const prefix = `${root}${scope}.`
  if (options.pruneOtherScopes === true) {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key?.startsWith(root) === true && !key.startsWith(prefix)) storage.removeItem(key)
    }
  }
  return Object.freeze({
    get(fingerprint: string) {
      const raw = storage.getItem(prefix + fingerprint)
      if (raw === null) return null
      try {
        const value = JSON.parse(raw) as AssetRecoveryRecord
        return value.schemaVersion === 1 && value.fingerprint === fingerprint ? value : null
      } catch {
        return null
      }
    },
    put(record: AssetRecoveryRecord) { storage.setItem(prefix + record.fingerprint, JSON.stringify(record)) },
    delete(fingerprint: string) { storage.removeItem(prefix + fingerprint) },
  })
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return hex(bytes)
}

async function sha256(blob: Blob): Promise<string> {
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer())))
}

function fixedEndpoint(value: string): string {
  const endpoint = new URL(value)
  if (
    endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== "" ||
    endpoint.search !== "" || endpoint.hash !== ""
  ) throw new AssetUploadError("CAPABILITY_REJECTED", "Upload authorization was rejected")
  return endpoint.origin
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new AssetUploadError("UPLOAD_UNAVAILABLE", "Upload service returned an invalid response")
  }
}

function dataPlaneFailure(status: number, body: unknown): never {
  const candidate = body as Partial<DataPlaneErrorResponse>
  if (status === 401 || status === 403 || candidate.code === "UPLOAD_CAPABILITY_REJECTED") {
    throw new AssetUploadError("CAPABILITY_REJECTED", "Upload authorization expired; retry the upload")
  }
  if (candidate.retryClass === "never" || status === 409 || status === 413 || status === 422) {
    throw new AssetUploadError("UPLOAD_REJECTED", candidate.safeMessage ?? "Upload was rejected")
  }
  throw new AssetUploadError("UPLOAD_UNAVAILABLE", candidate.safeMessage ?? "Upload service is temporarily unavailable")
}

function parseDataResponse<T>(operation: keyof typeof ASSET_DATA_PLANE_OPERATIONS, value: unknown): T {
  const parsed = ASSET_DATA_PLANE_OPERATIONS[operation].responseSchema.safeParse(value)
  if (!parsed.success) throw new AssetUploadError("UPLOAD_UNAVAILABLE", "Upload service returned an invalid response")
  return parsed.data as T
}

function controlError(status: number, body: unknown): never {
  const candidate = body as { error?: { code?: string; message?: string } }
  if (status === 401 || status === 403) {
    throw new AssetUploadError("CONTROL_REJECTED", candidate.error?.message ?? "Sign in again")
  }
  if (status >= 400 && status < 500) {
    throw new AssetUploadError("UPLOAD_REJECTED", candidate.error?.message ?? "Upload was rejected")
  }
  throw new AssetUploadError("UPLOAD_UNAVAILABLE", candidate.error?.message ?? "Asset service is temporarily unavailable")
}

function command(): Command {
  return Object.freeze({ commandId: randomHex(16), idempotencyKey: randomHex(24) })
}

function recoveryRecord(file: File, checksumSha256: string, purpose: string): AssetRecoveryRecord {
  return Object.freeze({
    schemaVersion: 1,
    fingerprint: `${checksumSha256}:${file.size}:${file.type}`,
    filename: file.name,
    mediaType: file.type,
    size: file.size,
    checksumSha256,
    purpose,
    ownerCreate: command(),
    clientUploadId: `browser-${randomHex(16)}`,
    initiateIdempotencyKey: randomHex(24),
    partIdempotencyKeys: Object.freeze({}),
    dataCompleteIdempotencyKey: randomHex(24),
    dataCompleteExpectedVersion: null,
    ownerComplete: command(),
    owner: null,
  })
}

function withOwner(record: AssetRecoveryRecord, owner: OwnerUpload): AssetRecoveryRecord {
  return Object.freeze({ ...record, owner: Object.freeze({
    intentRef: owner.intentRef,
    sessionRef: owner.sessionRef,
    expectedVersion: owner.expectedVersion,
  }) })
}

function withPartKey(record: AssetRecoveryRecord, partNumber: number): AssetRecoveryRecord {
  const name = String(partNumber)
  if (record.partIdempotencyKeys[name] !== undefined) return record
  return Object.freeze({
    ...record,
    partIdempotencyKeys: Object.freeze({ ...record.partIdempotencyKeys, [name]: randomHex(24) }),
  })
}

export function createAssetUploader(options: Readonly<{
  csrfToken: string
  store?: AssetRecoveryStore
  fetch?: typeof globalThis.fetch
  maximumBytes?: number
  poll?: Readonly<{ attempts?: number; wait?: (milliseconds: number) => Promise<void> }>
}>) {
  const fetcher = options.fetch ?? globalThis.fetch
  const maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BROWSER_ASSET_BYTES
  const store = options.store ?? createLocalAssetRecoveryStore()
  const wait = options.poll?.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const pollAttempts = options.poll?.attempts ?? 90
  const lifetime = new AbortController()

  async function control(path: string, init?: Readonly<{ method: "POST"; body: unknown }>): Promise<unknown> {
    const response = await fetcher(`/api/assets${path}`, init === undefined ? {
      method: "GET", credentials: "same-origin", cache: "no-store", signal: lifetime.signal,
    } : {
      method: init.method,
      headers: {
        "content-type": "application/json",
        "x-kokoro-browser-csrf": options.csrfToken,
      },
      credentials: "same-origin",
      cache: "no-store",
      signal: lifetime.signal,
      body: JSON.stringify(init.body),
    })
    const body = await json(response)
    if (!response.ok) controlError(response.status, body)
    return body
  }

  async function ownerCreate(record: AssetRecoveryRecord): Promise<OwnerCreateResponse> {
    const body = await control("", { method: "POST", body: {
      command: record.ownerCreate,
      clientMediaType: record.mediaType,
      expectedChecksumSha256: record.checksumSha256,
      expectedSize: String(record.size),
      filename: record.filename,
      purpose: record.purpose,
    } }) as OwnerCreateResponse
    fixedEndpoint(body.capability.uploadEndpoint)
    if (body.capability.protocolRevision !== "s3-multipart-v1") {
      throw new AssetUploadError("CAPABILITY_REJECTED", "Unsupported upload protocol")
    }
    return body
  }

  async function dataRequest<T>(input: Readonly<{
    capability: Capability
    operation: "initiateAssetMultipartUpload" | "getAssetMultipartUploadStatus" |
      "putAssetMultipartPart" | "completeAssetMultipartUpload"
    method: "GET" | "POST" | "PUT"
    path: string
    headers?: Readonly<Record<string, string>>
    body?: BodyInit
  }>): Promise<T> {
    const response = await fetcher(`${fixedEndpoint(input.capability.uploadEndpoint)}${input.path}`, {
      method: input.method,
      headers: {
        authorization: `Bearer ${input.capability.credential}`,
        "kokoro-contract-version": "1",
        ...input.headers,
      },
      body: input.body,
      cache: "no-store",
      signal: lifetime.signal,
    })
    const body = await json(response)
    if (!response.ok) dataPlaneFailure(response.status, body)
    return parseDataResponse<T>(input.operation, body)
  }

  const status = (capability: Capability, uploadRef: string) => dataRequest<MultipartUploadStateResponse>({
    capability, operation: "getAssetMultipartUploadStatus", method: "GET",
    path: `/v1/multipart-uploads/${encodeURIComponent(uploadRef)}`,
  })

  async function upload(file: File, input: Readonly<{
    purpose?: string
    onProgress?: (progress: AssetUploadProgress) => void
  }> = {}): Promise<AssetAttachmentRef> {
    if (file.size < 1 || file.type.length < 3 || file.name.length < 1) {
      throw new AssetUploadError("FILE_INVALID", "Choose a non-empty file with a media type")
    }
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || file.size > maximumBytes) {
      throw new AssetUploadError("FILE_TOO_LARGE", `File must be at most ${maximumBytes} bytes`)
    }
    const progress = (phase: AssetUploadProgress["phase"], uploadedBytes: number) =>
      input.onProgress?.(Object.freeze({ phase, uploadedBytes, totalBytes: file.size }))
    progress("hashing", 0)
    const checksumSha256 = await sha256(file)
    const purpose = input.purpose ?? "chat.attachment"
    const fingerprint = `${checksumSha256}:${file.size}:${file.type}`
    let record = await store.get(fingerprint) ?? recoveryRecord(file, checksumSha256, purpose)
    if (
      record.filename !== file.name || record.size !== file.size || record.mediaType !== file.type ||
      record.checksumSha256 !== checksumSha256 || record.purpose !== purpose
    ) throw new AssetUploadError("FILE_INVALID", "Selected file does not match the recoverable upload")
    await store.put(record)

    progress("authorizing", 0)
    let ownerResponse: OwnerCreateResponse
    try {
      ownerResponse = await ownerCreate(record)
    } catch (error) {
      if (error instanceof AssetUploadError && error.code !== "UPLOAD_UNAVAILABLE") throw error
      ownerResponse = await ownerCreate(record)
    }
    record = withOwner(record, ownerResponse.upload)
    await store.put(record)
    if (ownerResponse.upload.stage === "ready" && ownerResponse.upload.attachment !== null) {
      await store.delete(fingerprint)
      progress("ready", file.size)
      return Object.freeze({ ...ownerResponse.upload.attachment })
    }
    const capability = ownerResponse.capability

    let multipart: MultipartUploadStateResponse
    try {
      multipart = await dataRequest({
        capability, operation: "initiateAssetMultipartUpload", method: "POST", path: "/v1/multipart-uploads",
        headers: { "content-type": "application/json", "idempotency-key": record.initiateIdempotencyKey },
        body: JSON.stringify({ clientUploadId: record.clientUploadId, protocolRevision: "s3-multipart-v1" }),
      })
    } catch (error) {
      if (error instanceof AssetUploadError && error.code !== "UPLOAD_UNAVAILABLE") throw error
      multipart = await dataRequest({
        capability, operation: "initiateAssetMultipartUpload", method: "POST", path: "/v1/multipart-uploads",
        headers: { "content-type": "application/json", "idempotency-key": record.initiateIdempotencyKey },
        body: JSON.stringify({ clientUploadId: record.clientUploadId, protocolRevision: "s3-multipart-v1" }),
      })
    }
    if (multipart.upload.expectedSize !== String(file.size)) {
      throw new AssetUploadError("UPLOAD_REJECTED", "Recoverable upload does not match the selected file")
    }
    const partSize = Number(multipart.upload.partSize)
    const minimumPartBytes = Number(capability.minimumPartBytes)
    const maximumPartBytes = Number(capability.maximumPartBytes)
    if (
      !Number.isSafeInteger(partSize) || partSize < 1 || partSize > maximumPartBytes ||
      partSize < minimumPartBytes && file.size > partSize
    ) throw new AssetUploadError("CAPABILITY_REJECTED", "Upload part policy was rejected")

    const parts = new Map<number, MultipartPart>(multipart.upload.parts.map((part) => [part.partNumber, part]))
    let uploadedBytes = [...parts.values()].reduce((total, part) => total + Number(part.size), 0)
    progress("uploading", Math.min(uploadedBytes, file.size))
    const count = Math.ceil(file.size / partSize)
    for (let partNumber = 1; partNumber <= count; partNumber += 1) {
      const start = (partNumber - 1) * partSize
      const blob = file.slice(start, Math.min(file.size, start + partSize))
      const partChecksum = await sha256(blob)
      const existing = parts.get(partNumber)
      if (existing !== undefined) {
        if (existing.checksumSha256 !== partChecksum || existing.size !== String(blob.size)) {
          throw new AssetUploadError("UPLOAD_REJECTED", "Committed upload part does not match the selected file")
        }
        continue
      }
      record = withPartKey(record, partNumber)
      await store.put(record)
      const put = () => dataRequest<MultipartPartResponse>({
        capability, operation: "putAssetMultipartPart", method: "PUT",
        path: `/v1/multipart-uploads/${encodeURIComponent(multipart.upload.uploadRef)}/parts/${partNumber}`,
        headers: {
          "content-type": "application/octet-stream",
          "idempotency-key": record.partIdempotencyKeys[String(partNumber)] as string,
          "x-kokoro-content-length": String(blob.size),
          "x-kokoro-content-sha256": partChecksum,
        },
        body: blob,
      })
      try {
        const response = await put()
        multipart = { receipt: response.receipt, upload: response.upload }
        parts.set(partNumber, response.part)
      } catch (error) {
        if (error instanceof AssetUploadError && error.code !== "UPLOAD_UNAVAILABLE") throw error
        const reconciled = await status(capability, multipart.upload.uploadRef)
        const committed = reconciled.upload.parts.find((part) => part.partNumber === partNumber)
        if (committed === undefined) {
          const response = await put()
          multipart = { receipt: response.receipt, upload: response.upload }
          parts.set(partNumber, response.part)
        } else {
          if (committed.checksumSha256 !== partChecksum || committed.size !== String(blob.size)) {
            throw new AssetUploadError("UPLOAD_REJECTED", "Reconciled upload part does not match the selected file")
          }
          multipart = reconciled
          parts.set(partNumber, committed)
        }
      }
      uploadedBytes += blob.size
      progress("uploading", Math.min(uploadedBytes, file.size))
    }

    const committedParts = [...parts.values()].sort((left, right) => left.partNumber - right.partNumber)
      .map(({ partNumber, partReceipt }) => ({ partNumber, partReceipt }))
    if (record.dataCompleteExpectedVersion === null) {
      record = Object.freeze({ ...record, dataCompleteExpectedVersion: multipart.upload.expectedVersion })
      await store.put(record)
    }
    const dataCompleteBody = JSON.stringify({
      expectedChecksumSha256: checksumSha256,
      expectedSize: String(file.size),
      expectedVersion: record.dataCompleteExpectedVersion,
      parts: committedParts,
    })
    const completeData = () => dataRequest<MultipartUploadStateResponse>({
      capability, operation: "completeAssetMultipartUpload", method: "POST",
      path: `/v1/multipart-uploads/${encodeURIComponent(multipart.upload.uploadRef)}:complete`,
      headers: { "content-type": "application/json", "idempotency-key": record.dataCompleteIdempotencyKey },
      body: dataCompleteBody,
    })
    progress("verifying", file.size)
    try {
      multipart = await completeData()
    } catch (error) {
      if (error instanceof AssetUploadError && error.code !== "UPLOAD_UNAVAILABLE") throw error
      multipart = await status(capability, multipart.upload.uploadRef)
      if (multipart.upload.state !== "uploaded" && multipart.upload.state !== "completing") {
        multipart = await completeData()
      }
    }
    for (let attempt = 0; attempt < 12 && ["completing", "outcome_unknown"].includes(multipart.upload.state); attempt += 1) {
      await wait(500)
      multipart = await status(capability, multipart.upload.uploadRef)
    }
    if (multipart.upload.state === "integrity_rejected" || multipart.upload.state === "aborted") {
      throw new AssetUploadError("UPLOAD_REJECTED", "Uploaded bytes failed integrity verification")
    }
    if (multipart.upload.state !== "uploaded") {
      throw new AssetUploadError("UPLOAD_UNAVAILABLE", "Upload completion is still reconciling; retry the upload")
    }

    if (record.owner === null) throw new AssetUploadError("CONTROL_REJECTED", "Upload owner state was lost")
    const completeOwner = () => control(`/${encodeURIComponent(record.owner?.intentRef ?? "")}/complete`, {
      method: "POST",
      body: { command: record.ownerComplete, expectedVersion: record.owner?.expectedVersion,
        sessionRef: record.owner?.sessionRef },
    }) as Promise<{ upload: OwnerUpload }>
    let owner: OwnerUpload
    try {
      owner = (await completeOwner()).upload
    } catch (error) {
      if (error instanceof AssetUploadError && error.code !== "UPLOAD_UNAVAILABLE") throw error
      owner = ((await control(`/${encodeURIComponent(record.owner.intentRef)}`)) as { upload: OwnerUpload }).upload
      if (owner.stage === "uploading" || owner.stage === "upload_interrupted") owner = (await completeOwner()).upload
    }

    progress("processing", file.size)
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      if (owner.stage === "ready" && owner.attachment !== null) {
        await store.delete(fingerprint)
        progress("ready", file.size)
        return Object.freeze({ ...owner.attachment })
      }
      if (owner.stage === "rejected" || owner.stage === "aborted" || owner.terminal) {
        throw new AssetUploadError("PROCESSING_REJECTED", owner.safeReasonCode ?? "Asset processing was rejected")
      }
      const retryAt = owner.retryAfter === null ? 0 : Date.parse(owner.retryAfter)
      await wait(Math.max(250, Math.min(2_000, Number.isFinite(retryAt) ? retryAt - Date.now() : 750)))
      owner = ((await control(`/${encodeURIComponent(record.owner.intentRef)}`)) as { upload: OwnerUpload }).upload
    }
    throw new AssetUploadError("PROCESSING_TIMEOUT", "Asset processing is still in progress; retry status later")
  }

  return Object.freeze({
    upload,
    dispose() { lifetime.abort("Asset uploader scope changed") },
  })
}
