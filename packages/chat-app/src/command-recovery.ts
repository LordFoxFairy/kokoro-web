import type {
  BrowserCommandOperation,
  CommandIdentity,
} from "@kokoro/session-client/contracts"
import {
  BROWSER_COMMAND_TARGET_KEYS,
  commandIdentitySchema,
} from "@kokoro/session-client/contracts"

const STORAGE_KEY = "kokoro.chat.pending-command.v1"
const MAXIMUM_AGE_MS = 24 * 60 * 60 * 1_000
const MAXIMUM_FUTURE_SKEW_MS = 5 * 60 * 1_000

export type SessionCommandStorage = Readonly<{
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}>

export type SessionCommandRecoveryRecord = Readonly<{
  schemaVersion: 1
  operation: BrowserCommandOperation
  command: CommandIdentity
  sessionId?: string
  createdAt: number
}>

export type SessionCommandRecoveryStore = Readonly<{
  load(): SessionCommandRecoveryRecord | null
  save(record: SessionCommandRecoveryRecord): void
  clear(commandId: string): void
}>

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseRecord(value: unknown, now: number): SessionCommandRecoveryRecord | null {
  if (!plainRecord(value)) return null
  const keys = Object.keys(value).sort()
  const expectedKeys = value.sessionId === undefined
    ? ["command", "createdAt", "operation", "schemaVersion"]
    : ["command", "createdAt", "operation", "schemaVersion", "sessionId"]
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return null
  if (
    value.schemaVersion !== 1 ||
    typeof value.operation !== "string" ||
    !Object.hasOwn(BROWSER_COMMAND_TARGET_KEYS, value.operation) ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    value.createdAt > now + MAXIMUM_FUTURE_SKEW_MS ||
    now - value.createdAt > MAXIMUM_AGE_MS ||
    (value.sessionId !== undefined &&
      (typeof value.sessionId !== "string" || value.sessionId.length < 1 || value.sessionId.length > 128))
  ) return null
  const parsedCommand = commandIdentitySchema.safeParse(value.command)
  if (!parsedCommand.success) return null
  return Object.freeze({
    schemaVersion: 1,
    operation: value.operation as BrowserCommandOperation,
    command: Object.freeze(parsedCommand.data),
    ...(value.sessionId === undefined ? {} : { sessionId: value.sessionId as string }),
    createdAt: value.createdAt,
  })
}

export function createSessionCommandRecoveryStore(input: Readonly<{
  storage: SessionCommandStorage
  now?: () => number
}>): SessionCommandRecoveryStore {
  const now = input.now ?? Date.now

  const remove = (): void => {
    try {
      input.storage.removeItem(STORAGE_KEY)
    } catch {
      // Browser storage availability is not an authority signal.
    }
  }

  const load = (): SessionCommandRecoveryRecord | null => {
    let raw: string | null
    try {
      raw = input.storage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
    if (raw === null) return null
    if (raw.length > 8_192) {
      remove()
      return null
    }
    try {
      const parsed = parseRecord(JSON.parse(raw) as unknown, now())
      if (parsed === null) remove()
      return parsed
    } catch {
      remove()
      return null
    }
  }

  return Object.freeze({
    load,
    save(record) {
      const parsed = parseRecord(record, now())
      if (parsed === null) throw new TypeError("Invalid Session command recovery record")
      try {
        input.storage.setItem(STORAGE_KEY, JSON.stringify(parsed))
      } catch {
        // The in-memory controller record still prevents a new effect in this page.
      }
    },
    clear(commandId) {
      const current = load()
      if (current?.command.command_id === commandId) remove()
    },
  })
}
