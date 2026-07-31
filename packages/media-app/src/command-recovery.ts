import type { MediaOperationCommandReceipt } from "@kokoro/site-client"

export type MediaCommandReconciliation =
  | Readonly<{ kind: "terminal" }>
  | Readonly<{ kind: "recover_command" }>
  | Readonly<{ kind: "get_operation"; operationRef: string }>
  | Readonly<{ kind: "contact_support"; safeMessage: string }>

/** Closed interpretation of Platform's command receipt; outcome-unknown is never terminal. */
export function mediaCommandReconciliation(receipt: MediaOperationCommandReceipt): MediaCommandReconciliation {
  switch (receipt.receiptKind) {
    case "submit_accepted":
    case "submit_rejected":
    case "cancel_accepted":
    case "cancel_rejected":
      return Object.freeze({ kind: "terminal" })
    case "submit_outcome_unknown":
    case "cancel_outcome_unknown":
      switch (receipt.recoveryAction) {
        case "recover_command": return Object.freeze({ kind: "recover_command" })
        case "contact_support": return Object.freeze({
          kind: "contact_support",
          safeMessage: receipt.safeFailure.safeMessage,
        })
        case "get_operation":
          if ("operationRef" in receipt) return Object.freeze({ kind: "get_operation", operationRef: receipt.operationRef })
          throw new TypeError("media recovery omitted operation identity")
      }
  }
}

export function applyMediaCommandReceipt(
  storage: Readonly<{ forget(commandId: string): void }>,
  receipt: MediaOperationCommandReceipt,
): MediaCommandReconciliation {
  const reconciliation = mediaCommandReconciliation(receipt)
  if (reconciliation.kind === "terminal") storage.forget(receipt.commandId)
  return reconciliation
}
