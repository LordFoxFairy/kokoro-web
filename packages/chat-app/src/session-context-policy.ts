import type {
  AssetRecoveryRecord,
  AssetRecoveryStore,
} from "@kokoro/asset-client"
import type { SessionMetadata } from "@kokoro/session-client/contracts"

export type SessionContextPolicy = SessionMetadata["context_policy"]

const STANDARD_PERSISTENCE = Object.freeze({
  commandRecovery: true,
  composerDraft: true,
  uploadRecovery: true,
  ordinaryHistory: true,
})

const TEMPORARY_PERSISTENCE = Object.freeze({
  commandRecovery: false,
  composerDraft: false,
  uploadRecovery: false,
  ordinaryHistory: false,
})

export function sessionBrowserPersistence(contextPolicy: SessionContextPolicy) {
  return contextPolicy === "temporary" ? TEMPORARY_PERSISTENCE : STANDARD_PERSISTENCE
}

export function createEphemeralAssetRecoveryStore(): AssetRecoveryStore {
  const records = new Map<string, AssetRecoveryRecord>()
  const store: AssetRecoveryStore = {
    get: (fingerprint) => records.get(fingerprint) ?? null,
    put: (record) => void records.set(record.fingerprint, record),
    delete: (fingerprint) => void records.delete(fingerprint),
  }
  return Object.freeze(store)
}
