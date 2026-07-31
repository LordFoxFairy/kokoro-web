import {
  validateMediaOperationTransition,
  type MediaOperationOwnerState,
} from "@kokoro/chat-surface"

export const MEDIA_OPERATION_TERMINAL_STATES = new Set<MediaOperationOwnerState["state"]>([
  "completed", "partial", "failed", "canceled",
])

export function mergeMediaOperationOwnerStates(
  current: readonly MediaOperationOwnerState[],
  updates: readonly MediaOperationOwnerState[],
): readonly MediaOperationOwnerState[] {
  const result = [...current]
  const additions: MediaOperationOwnerState[] = []
  let changed = false
  for (const update of updates) {
    const index = result.findIndex(({ mediaOperationRef }) => mediaOperationRef === update.mediaOperationRef)
    if (index < 0) {
      additions.push(update)
      changed = true
      continue
    }
    const existing = result[index]
    if (existing === undefined || validateMediaOperationTransition(existing, update) !== undefined) continue
    if (BigInt(existing.ownerVersion) === BigInt(update.ownerVersion)) continue
    result[index] = update
    changed = true
  }
  return changed ? Object.freeze([...additions, ...result]) : current
}
