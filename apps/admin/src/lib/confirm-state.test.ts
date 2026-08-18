import { describe, expect, it } from 'vitest'
import {
  beginConfirmSubmit,
  canSubmitConfirmation,
  closeConfirmation,
  createConfirmState,
  failConfirmSubmit,
  openConfirmation,
  setConfirmationText,
  setConfirmReason,
  succeedConfirmSubmit,
} from './confirm-state'
import type { AdminError } from './view-models'

const revokeSession = {
  action: 'revoke-session',
  object: { id: 'session_01', label: 'Chrome on macOS' },
  impact: 'The session will be signed out immediately.',
  reasonRequired: true,
  confirmationText: 'REVOKE session_01',
} as const

function adminError(code: AdminError['code']): AdminError {
  return {
    kind: 'admin-data-error',
    code,
    businessCode: 'SESSION_CHANGED',
    fieldViolations: [],
    requestId: 'req_confirm',
    safeMessage: 'backend text must not reach confirmation state',
  }
}

describe('dangerous action confirmation state', () => {
  it('opens with explicit operation context and clears it on close', () => {
    const closed = createConfirmState()
    const open = openConfirmation(closed, revokeSession)
    const nextClosed = closeConfirmation(open)

    expect(closed).toEqual({ status: 'closed', revision: 0 })
    expect(open).toEqual({
      status: 'open',
      revision: 1,
      operation: revokeSession,
      confirmation: '',
      reason: '',
    })
    expect(nextClosed).toEqual({ status: 'closed', revision: 2 })
    expect(nextClosed).not.toHaveProperty('operation')
    expect(nextClosed).not.toHaveProperty('error')
  })

  it('requires an exact confirmation and a non-blank reason when configured', () => {
    const open = openConfirmation(createConfirmState(), revokeSession)
    const wrongCase = setConfirmationText(open, 'revoke session_01')
    const exact = setConfirmationText(wrongCase, 'REVOKE session_01')
    const blankReason = setConfirmReason(exact, '   ')
    const ready = setConfirmReason(blankReason, 'Compromised device')

    expect(canSubmitConfirmation(open)).toBe(false)
    expect(canSubmitConfirmation(wrongCase)).toBe(false)
    expect(canSubmitConfirmation(exact)).toBe(false)
    expect(canSubmitConfirmation(blankReason)).toBe(false)
    expect(canSubmitConfirmation(ready)).toBe(true)
    expect(beginConfirmSubmit(blankReason)).toBe(blankReason)
    expect(beginConfirmSubmit(ready).status).toBe('submitting')
  })

  it('allows exact confirmation without a reason when explicitly configured', () => {
    const state = openConfirmation(createConfirmState(), {
      action: 'archive-record',
      object: { id: 'record_01', label: 'Quarterly snapshot' },
      impact: 'The record will leave active results.',
      reasonRequired: false,
      confirmationText: 'ARCHIVE record_01',
    })

    expect(canSubmitConfirmation(state)).toBe(false)
    const confirmed = setConfirmationText(state, 'ARCHIVE record_01')
    expect(canSubmitConfirmation(confirmed)).toBe(true)
    expect(beginConfirmSubmit(confirmed).status).toBe('submitting')
  })

  it('moves through typing, submitting, and success without mutating input', () => {
    const open = openConfirmation(createConfirmState(), revokeSession)
    const typed = setConfirmReason(
      setConfirmationText(open, 'REVOKE session_01'),
      'Compromised device'
    )
    const submitting = beginConfirmSubmit(typed)
    const success = succeedConfirmSubmit(submitting, submitting.revision)

    expect(typed.status).toBe('typing')
    expect(submitting.status).toBe('submitting')
    expect(success.status).toBe('success')
    expect(success.confirmation).toBe('REVOKE session_01')
    expect(success.reason).toBe('Compromised device')
    expect(open.confirmation).toBe('')
    expect(open.reason).toBe('')
  })

  it.each([
    ['PERMISSION_DENIED', 'forbidden'],
    ['ALREADY_EXISTS', 'conflict'],
    ['FAILED_PRECONDITION', 'error'],
    ['UNAVAILABLE', 'error'],
  ] as const)('maps %s to %s and preserves operator input', (code, status) => {
    const typed = setConfirmReason(
      setConfirmationText(
        openConfirmation(createConfirmState(), revokeSession),
        'REVOKE session_01'
      ),
      'Compromised device'
    )
    const submitting = beginConfirmSubmit(typed)
    const failed = failConfirmSubmit(
      submitting,
      adminError(code),
      submitting.revision
    )

    expect(failed.status).toBe(status)
    expect(failed.confirmation).toBe('REVOKE session_01')
    expect(failed.reason).toBe('Compromised device')
    expect(failed.error).toEqual({
      code,
      businessCode: 'SESSION_CHANGED',
      requestId: 'req_confirm',
    })
    expect(JSON.stringify(failed)).not.toContain('backend text')
  })

  it('maps a forward-compatible unknown code to a safe error state', () => {
    const ready = setConfirmReason(
      setConfirmationText(
        openConfirmation(createConfirmState(), revokeSession),
        'REVOKE session_01'
      ),
      'Compromised device'
    )
    const submitting = beginConfirmSubmit(ready)
    const error = {
      ...adminError('UNKNOWN'),
      code: 'FUTURE_CONTRACT_CODE',
    } as unknown as AdminError
    const failed = failConfirmSubmit(submitting, error, submitting.revision)

    expect(failed.status).toBe('error')
    expect(failed.error?.code).toBe('UNKNOWN')
  })

  it('freezes input while submitting and ignores stale results after a newer submit', () => {
    const firstReady = setConfirmReason(
      setConfirmationText(
        openConfirmation(createConfirmState(), revokeSession),
        'REVOKE session_01'
      ),
      'First reason'
    )
    const firstSubmit = beginConfirmSubmit(firstReady)
    expect(setConfirmReason(firstSubmit, 'Second reason')).toBe(firstSubmit)
    expect(setConfirmationText(firstSubmit, 'OTHER')).toBe(firstSubmit)
    const firstFailure = failConfirmSubmit(
      firstSubmit,
      adminError('UNAVAILABLE'),
      firstSubmit.revision
    )
    const edited = setConfirmReason(firstFailure, 'Second reason')
    const secondSubmit = beginConfirmSubmit(edited)
    const closed = closeConfirmation(secondSubmit)
    const reopened = openConfirmation(closed, {
      ...revokeSession,
      object: { id: 'session_02', label: 'Safari on iPhone' },
      confirmationText: 'REVOKE session_02',
    })

    expect(succeedConfirmSubmit(edited, firstSubmit.revision)).toBe(edited)
    expect(
      failConfirmSubmit(
        secondSubmit,
        adminError('UNKNOWN'),
        firstSubmit.revision
      )
    ).toBe(secondSubmit)
    expect(succeedConfirmSubmit(reopened, secondSubmit.revision)).toBe(reopened)
    expect(reopened.operation.object.id).toBe('session_02')
    expect(reopened.confirmation).toBe('')
    expect(reopened.reason).toBe('')
  })

  it('rejects incomplete or unprotected dangerous action configuration', () => {
    expect(() =>
      openConfirmation(createConfirmState(), {
        action: '',
        object: { id: 'record_01', label: 'Record' },
        impact: 'Deletes the record.',
        reasonRequired: true,
      })
    ).toThrow('Confirmation action must be non-empty and trimmed')
    expect(() =>
      openConfirmation(createConfirmState(), {
        action: 'delete-record',
        object: { id: 'record_01', label: 'Record' },
        impact: 'Deletes the record.',
        reasonRequired: false,
      })
    ).toThrow(
      'A dangerous confirmation must require a reason or exact confirmation text'
    )
    expect(() =>
      openConfirmation(createConfirmState(), {
        action: 'delete-record',
        object: { id: 'record_01', label: 'Record' },
        impact: 'Deletes the record.',
        reasonRequired: false,
        confirmationText: '   ',
      })
    ).toThrow('confirmationText must be non-empty and trimmed')
  })

  it('clears stale errors when the operator edits and blocks duplicate submits', () => {
    const ready = setConfirmReason(
      setConfirmationText(
        openConfirmation(createConfirmState(), revokeSession),
        'REVOKE session_01'
      ),
      'Compromised device'
    )
    const submitting = beginConfirmSubmit(ready)
    const failed = failConfirmSubmit(
      submitting,
      adminError('UNAVAILABLE'),
      submitting.revision
    )
    const edited = setConfirmReason(failed, 'Device reported stolen')
    const secondSubmit = beginConfirmSubmit(edited)

    expect(edited.status).toBe('typing')
    expect(edited).not.toHaveProperty('error')
    expect(beginConfirmSubmit(secondSubmit)).toBe(secondSubmit)
  })
})
