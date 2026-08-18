import type { AdminError, AdminErrorCode } from './view-models'

export type ConfirmOperation = {
  readonly action: string
  readonly object: {
    readonly id: string
    readonly label: string
  }
  readonly impact: string
  readonly reasonRequired: boolean
  readonly confirmationText?: string
}

export type ConfirmFailure = {
  readonly code: AdminErrorCode
  readonly businessCode?: string
  readonly requestId: string
}

export type ClosedConfirmState = {
  readonly status: 'closed'
  readonly revision: number
}

export type ActiveConfirmState = {
  readonly status:
    | 'open'
    | 'typing'
    | 'submitting'
    | 'success'
    | 'error'
    | 'conflict'
    | 'forbidden'
  readonly revision: number
  readonly operation: ConfirmOperation
  readonly confirmation: string
  readonly reason: string
  readonly error?: ConfirmFailure
}

export type ConfirmState = ClosedConfirmState | ActiveConfirmState

export function createConfirmState(): ClosedConfirmState {
  return { status: 'closed', revision: 0 }
}

export function openConfirmation(
  state: ConfirmState,
  operation: ConfirmOperation
): ActiveConfirmState {
  const requiredText = [
    ['action', operation.action],
    ['object.id', operation.object.id],
    ['object.label', operation.object.label],
    ['impact', operation.impact],
  ] as const
  const invalidField = requiredText.find(
    ([, value]) => value.trim().length === 0 || value !== value.trim()
  )
  if (invalidField) {
    throw new Error(
      `Confirmation ${invalidField[0]} must be non-empty and trimmed`
    )
  }
  if (
    operation.confirmationText !== undefined &&
    (operation.confirmationText.trim().length === 0 ||
      operation.confirmationText !== operation.confirmationText.trim())
  ) {
    throw new Error(
      'Confirmation confirmationText must be non-empty and trimmed'
    )
  }
  if (!operation.reasonRequired && operation.confirmationText === undefined) {
    throw new Error(
      'A dangerous confirmation must require a reason or exact confirmation text'
    )
  }

  return {
    status: 'open',
    revision: state.revision + 1,
    operation: {
      ...operation,
      object: { ...operation.object },
    },
    confirmation: '',
    reason: '',
  }
}

export function closeConfirmation(state: ConfirmState): ClosedConfirmState {
  if (state.status === 'closed') return state
  return { status: 'closed', revision: state.revision + 1 }
}

function isEditable(state: ActiveConfirmState): boolean {
  return (
    state.status === 'open' ||
    state.status === 'typing' ||
    state.status === 'error' ||
    state.status === 'conflict' ||
    state.status === 'forbidden'
  )
}

export function setConfirmationText(
  state: ActiveConfirmState,
  confirmation: string
): ActiveConfirmState {
  if (!isEditable(state) || state.confirmation === confirmation) return state

  return {
    status: 'typing',
    revision: state.revision + 1,
    operation: state.operation,
    confirmation,
    reason: state.reason,
  }
}

export function setConfirmReason(
  state: ActiveConfirmState,
  reason: string
): ActiveConfirmState {
  if (!isEditable(state) || state.reason === reason) return state

  return {
    status: 'typing',
    revision: state.revision + 1,
    operation: state.operation,
    confirmation: state.confirmation,
    reason,
  }
}

export function canSubmitConfirmation(state: ConfirmState): boolean {
  if (
    state.status === 'closed' ||
    state.status === 'submitting' ||
    state.status === 'success'
  ) {
    return false
  }

  const expected = state.operation.confirmationText
  if (expected !== undefined && state.confirmation !== expected) return false
  if (state.operation.reasonRequired && state.reason.trim().length === 0) {
    return false
  }

  return true
}

export function beginConfirmSubmit(
  state: ActiveConfirmState
): ActiveConfirmState {
  if (!canSubmitConfirmation(state)) return state

  return {
    status: 'submitting',
    revision: state.revision + 1,
    operation: state.operation,
    confirmation: state.confirmation,
    reason: state.reason,
  }
}

export function succeedConfirmSubmit(
  state: ActiveConfirmState,
  revision: number
): ActiveConfirmState {
  if (state.status !== 'submitting' || state.revision !== revision) return state

  return {
    status: 'success',
    revision: state.revision,
    operation: state.operation,
    confirmation: state.confirmation,
    reason: state.reason,
  }
}

function failureStatus(
  code: AdminErrorCode
): 'error' | 'conflict' | 'forbidden' {
  switch (code) {
    case 'PERMISSION_DENIED':
      return 'forbidden'
    case 'ALREADY_EXISTS':
      return 'conflict'
    case 'UNAUTHENTICATED':
    case 'INVALID_ARGUMENT':
    case 'NOT_FOUND':
    case 'FAILED_PRECONDITION':
    case 'RESOURCE_EXHAUSTED':
    case 'UNAVAILABLE':
    case 'DEADLINE_EXCEEDED':
    case 'UNKNOWN':
      return 'error'
    default:
      return 'error'
  }
}

function safeErrorCode(code: AdminErrorCode): AdminErrorCode {
  switch (code) {
    case 'PERMISSION_DENIED':
    case 'ALREADY_EXISTS':
    case 'UNAUTHENTICATED':
    case 'INVALID_ARGUMENT':
    case 'NOT_FOUND':
    case 'FAILED_PRECONDITION':
    case 'RESOURCE_EXHAUSTED':
    case 'UNAVAILABLE':
    case 'DEADLINE_EXCEEDED':
    case 'UNKNOWN':
      return code
    default:
      return 'UNKNOWN'
  }
}

export function failConfirmSubmit(
  state: ActiveConfirmState,
  error: AdminError,
  revision: number
): ActiveConfirmState {
  if (state.status !== 'submitting' || state.revision !== revision) return state

  const code = safeErrorCode(error.code)
  return {
    status: failureStatus(code),
    revision: state.revision,
    operation: state.operation,
    confirmation: state.confirmation,
    reason: state.reason,
    error: {
      code,
      businessCode: error.businessCode,
      requestId: error.requestId,
    },
  }
}
