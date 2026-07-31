import type {
  SessionCommandRecoveryRecord,
  SessionCommandRecoveryStore,
} from "./command-recovery"
import {
  sessionBrowserPersistence,
  type SessionContextPolicy,
} from "./session-context-policy"

export type SessionPolicyObservation =
  | Readonly<{ kind: "accepted"; contextPolicy: SessionContextPolicy }>
  | Readonly<{
      kind: "mismatch"
      expectedContextPolicy: SessionContextPolicy
      receivedContextPolicy: SessionContextPolicy
    }>

type PendingCommand = Readonly<{
  record: SessionCommandRecoveryRecord
  persisted: boolean
}>

/**
 * Browser-only coordination for owner policy observations and uncertain command recovery.
 * Owner policy is immutable for a Session ID for the lifetime of this runtime. Persistent
 * standard-chat recovery may be deferred, but a temporary chat's exact in-memory identity
 * remains recoverable until its outcome is known.
 */
export function createSessionContextCoordinator(options: {
  readonly commandRecoveryStore?: SessionCommandRecoveryStore
}) {
  const ownerPolicies = new Map<string, SessionContextPolicy>()
  let deferredPersistentCommand = options.commandRecoveryStore?.load() ?? null
  let pendingCommand: PendingCommand | null = deferredPersistentCommand === null
    ? null
    : { record: deferredPersistentCommand, persisted: true }

  const observe = (
    sessionId: string,
    contextPolicy: SessionContextPolicy,
  ): SessionPolicyObservation => {
    const expectedContextPolicy = ownerPolicies.get(sessionId)
    if (expectedContextPolicy !== undefined && expectedContextPolicy !== contextPolicy) {
      return Object.freeze({
        kind: "mismatch",
        expectedContextPolicy,
        receivedContextPolicy: contextPolicy,
      })
    }
    ownerPolicies.set(sessionId, contextPolicy)

    if (contextPolicy === "temporary" && pendingCommand?.persisted === true) {
      deferredPersistentCommand = pendingCommand.record
      pendingCommand = null
    } else if (contextPolicy === "standard" && pendingCommand === null && deferredPersistentCommand !== null) {
      pendingCommand = { record: deferredPersistentCommand, persisted: true }
    }
    return Object.freeze({ kind: "accepted", contextPolicy })
  }

  const remember = (
    record: SessionCommandRecoveryRecord,
    contextPolicy: SessionContextPolicy | null,
  ): void => {
    const persisted = contextPolicy === null || sessionBrowserPersistence(contextPolicy).commandRecovery
    pendingCommand = { record, persisted }
    if (persisted) {
      deferredPersistentCommand = record
      options.commandRecoveryStore?.save(record)
    }
  }

  const forget = (commandId: string): void => {
    if (pendingCommand?.record.command.command_id !== commandId) return
    const persisted = pendingCommand.persisted
    pendingCommand = null
    if (!persisted) return
    if (deferredPersistentCommand?.command.command_id === commandId) deferredPersistentCommand = null
    options.commandRecoveryStore?.clear(commandId)
  }

  return Object.freeze({
    observe,
    getPendingCommand: (): SessionCommandRecoveryRecord | null => pendingCommand?.record ?? null,
    remember,
    forget,
  })
}

export type SessionContextCoordinator = ReturnType<typeof createSessionContextCoordinator>
