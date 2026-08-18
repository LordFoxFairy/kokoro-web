import { describe, expect, it } from 'vitest'
import {
  isRetryableAdminError,
  matchPageState,
  pageStateFromError,
  partialPageState,
  type PageState,
} from './page-state'
import type { AdminError, AdminErrorCode } from './view-models'

const codes = [
  ['UNAUTHENTICATED', 'unauthenticated', false],
  ['PERMISSION_DENIED', 'forbidden', false],
  ['INVALID_ARGUMENT', 'error', false],
  ['NOT_FOUND', 'not-found', false],
  ['ALREADY_EXISTS', 'error', false],
  ['FAILED_PRECONDITION', 'error', false],
  ['RESOURCE_EXHAUSTED', 'error', true],
  ['UNAVAILABLE', 'error', true],
  ['DEADLINE_EXCEEDED', 'error', true],
  ['UNKNOWN', 'error', true],
] as const satisfies readonly (readonly [
  AdminErrorCode,
  PageState<never>['status'],
  boolean,
])[]

function adminError(code: AdminErrorCode): AdminError {
  return {
    kind: 'admin-data-error',
    code,
    businessCode: 'STRUCTURED_CODE',
    fieldViolations: [{ path: 'displayName', code: 'REQUIRED' }],
    requestId: `req_${code.toLowerCase()}`,
    retryAfterMs: 750,
    safeMessage: 'must not become presentation state',
  }
}

describe('pageStateFromError', () => {
  it.each(codes)(
    'maps %s to %s with retryable=%s',
    (code, status, retryable) => {
      const state = pageStateFromError(adminError(code), 'req_fallback')

      expect(state.status).toBe(status)
      expect(isRetryableAdminError(code)).toBe(retryable)
      if (!('error' in state)) throw new Error('expected an error state')
      expect(state.error).toEqual({
        code,
        businessCode: 'STRUCTURED_CODE',
        fieldViolations: [{ path: 'displayName', code: 'REQUIRED' }],
        requestId: `req_${code.toLowerCase()}`,
        retryable,
        retryAfterMs: 750,
      })
      expect(state.error).not.toHaveProperty('safeMessage')
      expect(state.error).not.toHaveProperty('message')
    }
  )

  it('maps an unknown thrown value to a correlated UNKNOWN error', () => {
    const state = pageStateFromError(
      new Error('transport detail must stay private'),
      'req_fallback'
    )

    expect(state).toEqual({
      status: 'error',
      error: {
        code: 'UNKNOWN',
        fieldViolations: [],
        requestId: 'req_fallback',
        retryable: true,
      },
    })
  })
})

describe('page state lifecycle', () => {
  it('retains structured error metadata in partial state', () => {
    expect(partialPageState(['cached'], adminError('UNAVAILABLE'))).toEqual({
      status: 'partial',
      data: ['cached'],
      error: {
        code: 'UNAVAILABLE',
        businessCode: 'STRUCTURED_CODE',
        fieldViolations: [{ path: 'displayName', code: 'REQUIRED' }],
        requestId: 'req_unavailable',
        retryable: true,
        retryAfterMs: 750,
      },
    })
  })

  it('exhaustively dispatches all eight states', () => {
    const handlers = {
      loading: () => 'loading',
      ready: (data: string) => `ready:${data}`,
      empty: () => 'empty',
      error: () => 'error',
      unauthenticated: () => 'unauthenticated',
      forbidden: () => 'forbidden',
      'not-found': () => 'not-found',
      partial: (data: string) => `partial:${data}`,
    }
    const error = pageStateFromError<string>(adminError('UNKNOWN'), 'fallback')
    const states: readonly PageState<string>[] = [
      { status: 'loading' },
      { status: 'ready', data: 'data' },
      { status: 'empty' },
      error,
      pageStateFromError(adminError('UNAUTHENTICATED'), 'fallback'),
      pageStateFromError(adminError('PERMISSION_DENIED'), 'fallback'),
      pageStateFromError(adminError('NOT_FOUND'), 'fallback'),
      partialPageState('cached', adminError('UNAVAILABLE')),
    ]

    expect(states.map((state) => matchPageState(state, handlers))).toEqual([
      'loading',
      'ready:data',
      'empty',
      'error',
      'unauthenticated',
      'forbidden',
      'not-found',
      'partial:cached',
    ])
  })
})
