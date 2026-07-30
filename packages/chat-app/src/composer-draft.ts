const STORAGE_ROOT = "kokoro.chat.composer-draft.v1."
const MAXIMUM_TEXT_LENGTH = 1_048_576
const MAXIMUM_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const MAXIMUM_FUTURE_SKEW_MS = 5 * 60 * 1_000
const SCOPE_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u

export type ComposerDraft = Readonly<{
  schemaVersion: 1
  sessionId: string
  revision: string
  text: string
  modelOptionRevisionRef?: string
  effort?: string
  updatedAt: number
}>

export type ComposerDraftStorage = Readonly<{
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  readonly length?: number
  key?(index: number): string | null
}>

export type ComposerDraftStore = Readonly<{
  load(sessionId: string): ComposerDraft | null
  save(draft: ComposerDraft): void
  clear(sessionId: string, revision: string): void
}>

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseDraft(value: unknown, expectedSessionId: string, now: number): ComposerDraft | null {
  if (!plainRecord(value)) return null
  const keys = Object.keys(value).sort()
  const expectedKeys = [
    ...(value.effort === undefined ? [] : ["effort"]),
    ...(value.modelOptionRevisionRef === undefined ? [] : ["modelOptionRevisionRef"]),
    "revision",
    "schemaVersion",
    "sessionId",
    "text",
    "updatedAt",
  ]
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    value.schemaVersion !== 1 ||
    value.sessionId !== expectedSessionId ||
    typeof value.revision !== "string" ||
    !ID_PATTERN.test(value.revision) ||
    typeof value.text !== "string" ||
    value.text.length > MAXIMUM_TEXT_LENGTH ||
    (value.modelOptionRevisionRef !== undefined &&
      (typeof value.modelOptionRevisionRef !== "string" || value.modelOptionRevisionRef.length < 1 || value.modelOptionRevisionRef.length > 256)) ||
    (value.effort !== undefined &&
      (typeof value.effort !== "string" || value.effort.length < 1 || value.effort.length > 64)) ||
    typeof value.updatedAt !== "number" ||
    !Number.isSafeInteger(value.updatedAt) ||
    value.updatedAt < 0 ||
    value.updatedAt > now + MAXIMUM_FUTURE_SKEW_MS ||
    now - value.updatedAt > MAXIMUM_AGE_MS
  ) return null
  return Object.freeze({
    schemaVersion: 1,
    sessionId: expectedSessionId,
    revision: value.revision,
    text: value.text,
    ...(value.modelOptionRevisionRef === undefined ? {} : { modelOptionRevisionRef: value.modelOptionRevisionRef }),
    ...(value.effort === undefined ? {} : { effort: value.effort }),
    updatedAt: value.updatedAt,
  })
}

/**
 * Session-scoped composer persistence. Only editable text, product-level selection refs, and an
 * opaque local revision are stored; attachment grants, command payloads, credentials, and backend
 * references never enter it.
 */
export function createComposerDraftStore(input: Readonly<{
  storage: ComposerDraftStorage
  scope: string
  pruneOtherScopes?: boolean
  now?: () => number
}>): ComposerDraftStore {
  if (!SCOPE_PATTERN.test(input.scope)) throw new TypeError("Invalid browser runtime scope")
  const scopePrefix = `${STORAGE_ROOT}${encodeURIComponent(input.scope)}:`
  const now = input.now ?? Date.now

  if (
    input.pruneOtherScopes === true &&
    typeof input.storage.key === "function" &&
    typeof input.storage.length === "number"
  ) {
    for (let index = input.storage.length - 1; index >= 0; index -= 1) {
      const key = input.storage.key(index)
      if (key?.startsWith(STORAGE_ROOT) === true && !key.startsWith(scopePrefix)) {
        input.storage.removeItem(key)
      }
    }
  }

  const keyFor = (sessionId: string): string => {
    if (!ID_PATTERN.test(sessionId)) throw new TypeError("Invalid Session identity")
    return `${scopePrefix}${encodeURIComponent(sessionId)}`
  }
  const remove = (sessionId: string): void => {
    try {
      input.storage.removeItem(keyFor(sessionId))
    } catch {
      // Browser storage availability never becomes a product authority signal.
    }
  }

  const load = (sessionId: string): ComposerDraft | null => {
    let raw: string | null
    try {
      raw = input.storage.getItem(keyFor(sessionId))
    } catch {
      return null
    }
    if (raw === null) return null
    if (raw.length > MAXIMUM_TEXT_LENGTH + 1_024) {
      remove(sessionId)
      return null
    }
    try {
      const parsed = parseDraft(JSON.parse(raw) as unknown, sessionId, now())
      if (parsed === null) remove(sessionId)
      return parsed
    } catch {
      remove(sessionId)
      return null
    }
  }

  return Object.freeze({
    load,
    save(draft) {
      const parsed = parseDraft(draft, draft.sessionId, now())
      if (parsed === null) throw new TypeError("Invalid composer draft")
      try {
        if (parsed.text.length === 0) input.storage.removeItem(keyFor(parsed.sessionId))
        else input.storage.setItem(keyFor(parsed.sessionId), JSON.stringify(parsed))
      } catch {
        // The mounted composer remains authoritative for the current tab.
      }
    },
    clear(sessionId, revision) {
      const current = load(sessionId)
      if (current?.revision === revision) remove(sessionId)
    },
  })
}
