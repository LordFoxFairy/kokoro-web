declare const cursorBrand: unique symbol

/** An opaque Session-issued resume token. Consumers must never parse or sort it. */
export type SessionCursor = string & { readonly [cursorBrand]: "SessionCursor" }

export type CursorAcceptance =
  | { readonly kind: "ready"; readonly cursor: SessionCursor }
  | { readonly kind: "repair_required"; readonly reason: "missing_cursor" }
  | { readonly kind: "contract_incompatible"; readonly reason: "numeric_cursor" }

export type CursorRecovery =
  | { readonly kind: "reauthenticate"; readonly reason: "auth_required" }
  | { readonly kind: "rehydrate"; readonly reason: "cursor_expired" }
  | { readonly kind: "repair_required"; readonly reason: "cursor_conflict" | "cursor_rejected" }

export type CursorPolicy = {
  readonly accept: (value: unknown) => CursorAcceptance
  readonly onRejected: (status: number) => CursorRecovery
}

export function createCursorPolicy(): CursorPolicy {
  return {
    accept(value) {
      if (typeof value !== "string" || value.trim().length === 0) {
        return { kind: "repair_required", reason: "missing_cursor" }
      }
      // Numeric Last-Event-ID is the removed legacy replay axis. Refusing it
      // prevents accidental seq=0/full-history recovery in the new client.
      if (/^[0-9]+$/.test(value)) {
        return { kind: "contract_incompatible", reason: "numeric_cursor" }
      }
      return { kind: "ready", cursor: value as SessionCursor }
    },
    onRejected(status) {
      if (status === 401 || status === 403) {
        return { kind: "reauthenticate", reason: "auth_required" }
      }
      if (status === 410) {
        return { kind: "rehydrate", reason: "cursor_expired" }
      }
      if (status === 409) {
        return { kind: "repair_required", reason: "cursor_conflict" }
      }
      return { kind: "repair_required", reason: "cursor_rejected" }
    },
  }
}

export function unsafeCursorForContractTest(value: string): SessionCursor {
  return value as SessionCursor
}
