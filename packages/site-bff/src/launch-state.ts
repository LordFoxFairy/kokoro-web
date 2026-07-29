import "server-only"

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto"

import type { PublicCommandContext, SecretPublicCommandContext } from "@kokoro/site-client/server"

const MAXIMUM_ENTRIES = 8
const MAXIMUM_SEALED_BYTES = 16_384
const COMMAND_ID = /^[0-9a-f]{32}$/u
const IDEMPOTENCY_KEY = /^[0-9a-f]{48}$/u
const CAPABILITY = /^[0-9a-f]{64}$/u
const FLOW_REF = /^[A-Za-z0-9_-]{16,96}$/u

export type LaunchOperation =
  | "identity.register"
  | "identity.verify-email"
  | "identity.resend-verification"
  | "identity.revoke-sessions"
  | "identity.enroll-totp"
  | "identity.disable-totp"
  | "identity.regenerate-recovery-codes"
  | "redemption.preview"
  | "redemption.confirm"

const OPERATIONS = new Set<LaunchOperation>([
  "identity.register",
  "identity.verify-email",
  "identity.resend-verification",
  "identity.revoke-sessions",
  "identity.enroll-totp",
  "identity.disable-totp",
  "identity.regenerate-recovery-codes",
  "redemption.preview",
  "redemption.confirm",
])

export type SecurityLaunchState =
  | Readonly<{ phase: "reauthenticate_password"; supersedePriorCommandId?: string }>
  | Readonly<{
      phase: "reauthenticate_mfa"
      challengeKind: "totp" | "recovery"
      transactionRef: string
      supersedePriorCommandId?: string
    }>
  | Readonly<{
      phase: "totp_enrollment_delivery"
      reauthenticationProof: string
      supersedePriorCommandId?: string
      priorTransactionRef?: string
    }>
  | Readonly<{
      phase: "recovery_code_delivery"
      reauthenticationProof: string
      supersedePriorCommandId?: string
    }>
  | Readonly<{
      phase: "totp_confirmation"
      transactionRef: string
    }>
  | Readonly<{
      phase: "disable_confirmation"
      reauthenticationProof: string
    }>

export interface LaunchCommandState {
  readonly operation: LaunchOperation
  readonly flowRef: string
  readonly command: PublicCommandContext | SecretPublicCommandContext
  readonly createdAt: number
  readonly lastUsedAt: number
  readonly expiresAt: number
  /** Stored only after preview succeeds; never serialized into RSC or browser JSON. */
  readonly preview?: Readonly<{
    previewCredential: string
    legalAcceptanceRefs: readonly string[]
  }>
  /** Sensitive ceremony state is encrypted into the HttpOnly Site cookie and never exposed to browser code. */
  readonly security?: SecurityLaunchState
}

export interface LaunchStateBinding {
  readonly siteProjectBindingRef: string
  readonly deploymentRef: string
  readonly siteReleaseRef: string
  readonly webArtifactDigest: string
}

function context(binding: LaunchStateBinding): string {
  return [
    "kokoro-site-launch-state-v1",
    binding.siteProjectBindingRef,
    binding.deploymentRef,
    binding.siteReleaseRef,
    binding.webArtifactDigest,
  ].map((value) => `${value.length}:${value}`).join("|")
}

function key(secret: string): Buffer {
  if (secret.length < 32 || secret.length > 4096) throw new TypeError("launch state secret must be bounded")
  return createHash("sha256").update("kokoro-site-launch-state-key-v1\0").update(secret).digest()
}

function validEntry(value: unknown): value is LaunchCommandState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const command = item.command
  const preview = item.preview
  const security = item.security
  if (
    typeof item.operation !== "string" || !OPERATIONS.has(item.operation as LaunchOperation) ||
    typeof item.flowRef !== "string" || !FLOW_REF.test(item.flowRef) ||
    typeof item.createdAt !== "number" || !Number.isSafeInteger(item.createdAt) ||
    typeof item.lastUsedAt !== "number" || !Number.isSafeInteger(item.lastUsedAt) ||
    typeof item.expiresAt !== "number" || !Number.isSafeInteger(item.expiresAt) ||
    command === null || typeof command !== "object" || Array.isArray(command)
  ) return false
  const commandValue = command as Record<string, unknown>
  if (
    typeof commandValue.commandId !== "string" || !COMMAND_ID.test(commandValue.commandId) ||
    typeof commandValue.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(commandValue.idempotencyKey) ||
    (commandValue.receiptRecoveryCapability !== undefined &&
      (typeof commandValue.receiptRecoveryCapability !== "string" || !CAPABILITY.test(commandValue.receiptRecoveryCapability)))
  ) return false
  if (preview !== undefined) {
    if (preview === null || typeof preview !== "object" || Array.isArray(preview)) return false
    const previewValue = preview as Record<string, unknown>
    if (
      typeof previewValue.previewCredential !== "string" || previewValue.previewCredential.length < 16 || previewValue.previewCredential.length > 4096 ||
      !Array.isArray(previewValue.legalAcceptanceRefs) || previewValue.legalAcceptanceRefs.length > 64 ||
      previewValue.legalAcceptanceRefs.some((value) => typeof value !== "string" || value.length < 1 || value.length > 256)
    ) return false
  }
  const securityOperation = item.operation === "identity.enroll-totp" || item.operation === "identity.disable-totp" ||
    item.operation === "identity.regenerate-recovery-codes"
  if (securityOperation !== (security !== undefined)) return false
  if (securityOperation && preview !== undefined) return false
  if (security !== undefined) {
    if (security === null || typeof security !== "object" || Array.isArray(security)) return false
    const securityValue = security as Record<string, unknown>
    if (securityValue.phase === "reauthenticate_password") {
      if (
        (securityValue.supersedePriorCommandId !== undefined &&
          (typeof securityValue.supersedePriorCommandId !== "string" || !COMMAND_ID.test(securityValue.supersedePriorCommandId))) ||
        Object.keys(securityValue).some((name) => !["phase", "supersedePriorCommandId"].includes(name))
      ) return false
    } else if (securityValue.phase === "reauthenticate_mfa") {
      if (
        (securityValue.challengeKind !== "totp" && securityValue.challengeKind !== "recovery") ||
        typeof securityValue.transactionRef !== "string" || securityValue.transactionRef.length < 1 || securityValue.transactionRef.length > 256 ||
        (securityValue.supersedePriorCommandId !== undefined &&
          (typeof securityValue.supersedePriorCommandId !== "string" || !COMMAND_ID.test(securityValue.supersedePriorCommandId))) ||
        Object.keys(securityValue).some((name) => !["phase", "challengeKind", "transactionRef", "supersedePriorCommandId"].includes(name))
      ) return false
    } else if (securityValue.phase === "totp_enrollment_delivery") {
      if (
        item.operation !== "identity.enroll-totp" || typeof securityValue.reauthenticationProof !== "string" ||
        securityValue.reauthenticationProof.length < 32 || securityValue.reauthenticationProof.length > 4096 ||
        (securityValue.supersedePriorCommandId !== undefined &&
          (typeof securityValue.supersedePriorCommandId !== "string" || !COMMAND_ID.test(securityValue.supersedePriorCommandId))) ||
        (securityValue.priorTransactionRef !== undefined &&
          (typeof securityValue.priorTransactionRef !== "string" || securityValue.priorTransactionRef.length < 1 || securityValue.priorTransactionRef.length > 256)) ||
        ((securityValue.supersedePriorCommandId === undefined) !== (securityValue.priorTransactionRef === undefined)) ||
        Object.keys(securityValue).some((name) => !["phase", "reauthenticationProof", "supersedePriorCommandId", "priorTransactionRef"].includes(name))
      ) return false
    } else if (securityValue.phase === "recovery_code_delivery") {
      if (
        item.operation !== "identity.regenerate-recovery-codes" || typeof securityValue.reauthenticationProof !== "string" ||
        securityValue.reauthenticationProof.length < 32 || securityValue.reauthenticationProof.length > 4096 ||
        (securityValue.supersedePriorCommandId !== undefined &&
          (typeof securityValue.supersedePriorCommandId !== "string" || !COMMAND_ID.test(securityValue.supersedePriorCommandId))) ||
        Object.keys(securityValue).some((name) => !["phase", "reauthenticationProof", "supersedePriorCommandId"].includes(name))
      ) return false
    } else if (securityValue.phase === "totp_confirmation") {
      if (
        item.operation !== "identity.enroll-totp" || typeof securityValue.transactionRef !== "string" ||
        securityValue.transactionRef.length < 1 || securityValue.transactionRef.length > 256 ||
        Object.keys(securityValue).some((name) => !["phase", "transactionRef"].includes(name))
      ) return false
    } else if (securityValue.phase === "disable_confirmation") {
      if (
        item.operation !== "identity.disable-totp" || typeof securityValue.reauthenticationProof !== "string" ||
        securityValue.reauthenticationProof.length < 32 || securityValue.reauthenticationProof.length > 4096 ||
        Object.keys(securityValue).some((name) => !["phase", "reauthenticationProof"].includes(name))
      ) return false
    } else return false
    if (securityValue.phase !== "disable_confirmation" && commandValue.receiptRecoveryCapability === undefined) return false
  }
  return true
}

export function createLaunchStateVault(input: Readonly<{
  secret: string
  binding: LaunchStateBinding
  now?: () => number
  nonce?: () => Buffer
}>) {
  const encryptionKey = key(input.secret)
  const aad = Buffer.from(context(input.binding), "utf8")
  const now = input.now ?? Date.now
  const nonce = input.nonce ?? (() => randomBytes(12))

  function clean(entries: readonly LaunchCommandState[]): readonly LaunchCommandState[] {
    return Object.freeze(entries
      .filter((entry) => validEntry(entry) && entry.expiresAt > now())
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)
      .slice(-MAXIMUM_ENTRIES)
      .map((entry) => Object.freeze({
        ...entry,
        command: Object.freeze({ ...entry.command }),
        ...(entry.preview === undefined ? {} : { preview: Object.freeze({
          ...entry.preview,
          legalAcceptanceRefs: Object.freeze([...entry.preview.legalAcceptanceRefs]),
        }) }),
        ...(entry.security === undefined ? {} : { security: Object.freeze({ ...entry.security }) }),
      })))
  }

  function seal(entries: readonly LaunchCommandState[]): string {
    const initializationVector = nonce()
    if (initializationVector.byteLength !== 12) throw new TypeError("launch state nonce must be 96 bits")
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, initializationVector)
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(clean(entries)), "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()
    return `v1.${initializationVector.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`
  }

  function open(sealed: string | null | undefined): readonly LaunchCommandState[] {
    if (!sealed || Buffer.byteLength(sealed) > MAXIMUM_SEALED_BYTES) return Object.freeze([])
    const parts = sealed.split(".")
    if (parts.length !== 4 || parts[0] !== "v1") return Object.freeze([])
    try {
      const initializationVector = Buffer.from(parts[1] ?? "", "base64url")
      const ciphertext = Buffer.from(parts[2] ?? "", "base64url")
      const tag = Buffer.from(parts[3] ?? "", "base64url")
      if (
        initializationVector.byteLength !== 12 || tag.byteLength !== 16 || ciphertext.byteLength > MAXIMUM_SEALED_BYTES ||
        !timingSafeEqual(Buffer.from(initializationVector.toString("base64url")), Buffer.from(parts[1] ?? "")) ||
        !timingSafeEqual(Buffer.from(tag.toString("base64url")), Buffer.from(parts[3] ?? ""))
      ) return Object.freeze([])
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, initializationVector)
      decipher.setAAD(aad)
      decipher.setAuthTag(tag)
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      const parsed = JSON.parse(plaintext.toString("utf8")) as unknown
      if (!Array.isArray(parsed) || parsed.some((entry) => !validEntry(entry))) return Object.freeze([])
      return clean(parsed)
    } catch {
      return Object.freeze([])
    }
  }

  function put(entries: readonly LaunchCommandState[], entry: LaunchCommandState): readonly LaunchCommandState[] {
    if (!validEntry(entry)) throw new TypeError("invalid launch command state")
    const retained = clean(entries).filter((candidate) =>
      candidate.operation !== entry.operation || candidate.flowRef !== entry.flowRef)
    return clean([...retained, entry])
  }

  function find(entries: readonly LaunchCommandState[], operation: LaunchOperation, flowRef: string): LaunchCommandState | undefined {
    return clean(entries).find((entry) => entry.operation === operation && entry.flowRef === flowRef)
  }

  return Object.freeze({
    clean,
    seal,
    open,
    put,
    find,
  })
}

export type LaunchStateVault = ReturnType<typeof createLaunchStateVault>
