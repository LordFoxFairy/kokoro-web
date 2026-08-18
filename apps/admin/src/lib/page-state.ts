import {
  isAdminError,
  type AdminError,
  type AdminErrorCode,
  type FieldViolation,
} from './view-models'

export type PageError = {
  readonly code: AdminErrorCode
  readonly businessCode?: string
  readonly fieldViolations: readonly FieldViolation[]
  readonly requestId: string
  readonly retryable: boolean
  readonly retryAfterMs?: number
}

export type PageState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'empty' }
  | { readonly status: 'error'; readonly error: PageError }
  | { readonly status: 'forbidden'; readonly error: PageError }
  | { readonly status: 'not-found'; readonly error: PageError }
  | {
      readonly status: 'partial'
      readonly data: T
      readonly error: PageError
    }

export type PageStateHandlers<T, Result> = {
  readonly loading: () => Result
  readonly ready: (data: T) => Result
  readonly empty: () => Result
  readonly error: (error: PageError) => Result
  readonly forbidden: (error: PageError) => Result
  readonly 'not-found': (error: PageError) => Result
  readonly partial: (data: T, error: PageError) => Result
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected page state: ${String(value)}`)
}

export function isRetryableAdminError(code: AdminErrorCode): boolean {
  switch (code) {
    case 'RESOURCE_EXHAUSTED':
    case 'UNAVAILABLE':
    case 'DEADLINE_EXCEEDED':
    case 'UNKNOWN':
      return true
    case 'UNAUTHENTICATED':
    case 'PERMISSION_DENIED':
    case 'INVALID_ARGUMENT':
    case 'NOT_FOUND':
    case 'ALREADY_EXISTS':
    case 'FAILED_PRECONDITION':
      return false
    default:
      return assertNever(code)
  }
}

function toPageError(error: AdminError): PageError {
  return {
    code: error.code,
    businessCode: error.businessCode,
    fieldViolations: error.fieldViolations,
    requestId: error.requestId,
    retryable: isRetryableAdminError(error.code),
    retryAfterMs: error.retryAfterMs,
  }
}

export function pageStateFromError<T>(
  error: unknown,
  fallbackRequestId: string
): PageState<T> {
  const pageError = isAdminError(error)
    ? toPageError(error)
    : toPageError({
        kind: 'admin-data-error',
        code: 'UNKNOWN',
        fieldViolations: [],
        requestId: fallbackRequestId,
      })

  switch (pageError.code) {
    case 'PERMISSION_DENIED':
      return { status: 'forbidden', error: pageError }
    case 'NOT_FOUND':
      return { status: 'not-found', error: pageError }
    case 'UNAUTHENTICATED':
    case 'INVALID_ARGUMENT':
    case 'ALREADY_EXISTS':
    case 'FAILED_PRECONDITION':
    case 'RESOURCE_EXHAUSTED':
    case 'UNAVAILABLE':
    case 'DEADLINE_EXCEEDED':
    case 'UNKNOWN':
      return { status: 'error', error: pageError }
    default:
      return assertNever(pageError.code)
  }
}

export function partialPageState<T>(data: T, error: AdminError): PageState<T> {
  return { status: 'partial', data, error: toPageError(error) }
}

export function matchPageState<T, Result>(
  state: PageState<T>,
  handlers: PageStateHandlers<T, Result>
): Result {
  switch (state.status) {
    case 'loading':
      return handlers.loading()
    case 'ready':
      return handlers.ready(state.data)
    case 'empty':
      return handlers.empty()
    case 'error':
      return handlers.error(state.error)
    case 'forbidden':
      return handlers.forbidden(state.error)
    case 'not-found':
      return handlers['not-found'](state.error)
    case 'partial':
      return handlers.partial(state.data, state.error)
    default:
      return assertNever(state)
  }
}
