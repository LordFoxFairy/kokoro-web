import { describe, expect, it } from 'vitest'
import {
  beginFormSubmit,
  createFormState,
  editFormField,
  failFormSubmit,
  succeedFormSubmit,
} from './form-state'
import type { AdminError } from './view-models'

type Values = {
  readonly displayName: string
  readonly email: string
}

const fields = ['displayName', 'email'] as const
const initialValues: Values = {
  displayName: 'Ada',
  email: 'ada@example.test',
}

function adminError(
  code: AdminError['code'],
  fieldViolations: AdminError['fieldViolations'] = []
): AdminError {
  return {
    kind: 'admin-data-error',
    code,
    businessCode: 'STABLE_BUSINESS_CODE',
    fieldViolations,
    requestId: 'req_form',
    safeMessage: 'backend text must not reach presentation state',
  }
}

describe('form submission state', () => {
  it('moves through idle, editing, submitting, and success immutably', () => {
    const idle = createFormState(initialValues)
    const editing = editFormField(idle, 'displayName', 'Grace')
    const submitting = beginFormSubmit(editing)
    const success = succeedFormSubmit(submitting, submitting.revision)

    expect(idle).toEqual({
      status: 'idle',
      revision: 0,
      values: initialValues,
      fieldErrors: {},
      formErrors: [],
    })
    expect(editing).toEqual({
      status: 'editing',
      revision: 1,
      values: { ...initialValues, displayName: 'Grace' },
      fieldErrors: {},
      formErrors: [],
    })
    expect(submitting.status).toBe('submitting')
    expect(success.status).toBe('success')
    expect(success.values).toEqual({ ...initialValues, displayName: 'Grace' })
    expect(idle.values).toEqual(initialValues)
    expect(editing).not.toBe(idle)
    expect(submitting).not.toBe(editing)
  })

  it('fails closed on duplicate submit and terminal transitions', () => {
    const submitting = beginFormSubmit(createFormState(initialValues))

    expect(beginFormSubmit(submitting)).toBe(submitting)
    expect(succeedFormSubmit(createFormState(initialValues), 0)).toEqual(
      createFormState(initialValues)
    )
    expect(
      failFormSubmit(
        createFormState(initialValues),
        adminError('UNKNOWN'),
        fields,
        0
      )
    ).toEqual(createFormState(initialValues))
  })
})

describe('server error mapping', () => {
  it('maps only declared field paths and sends unknown paths to form errors', () => {
    const submitting = beginFormSubmit(createFormState(initialValues))
    const result = failFormSubmit(
      submitting,
      adminError('INVALID_ARGUMENT', [
        { path: 'displayName', code: 'REQUIRED' },
        { path: 'displayName', code: 'TOO_SHORT' },
        { path: 'profile.secret', code: 'INVALID' },
      ]),
      fields,
      submitting.revision
    )

    expect(result).toEqual({
      status: 'error',
      revision: 1,
      values: initialValues,
      fieldErrors: { displayName: ['REQUIRED', 'TOO_SHORT'] },
      formErrors: [
        {
          code: 'INVALID_ARGUMENT',
          businessCode: 'STABLE_BUSINESS_CODE',
          violationCode: 'INVALID',
          requestId: 'req_form',
        },
      ],
    })
    expect(result).not.toHaveProperty('safeMessage')
    expect(JSON.stringify(result)).not.toContain('backend text')
  })

  it.each([
    ['PERMISSION_DENIED', 'forbidden'],
    ['ALREADY_EXISTS', 'conflict'],
    ['FAILED_PRECONDITION', 'error'],
    ['UNAVAILABLE', 'error'],
  ] as const)('maps %s to %s and preserves input', (code, status) => {
    const values = { ...initialValues, displayName: 'Pending edit' }
    const submitting = beginFormSubmit(createFormState(values))
    const result = failFormSubmit(
      submitting,
      adminError(code),
      fields,
      submitting.revision
    )

    expect(result.status).toBe(status)
    expect(result.values).toEqual(values)
    expect(result.formErrors).toEqual([
      {
        code,
        businessCode: 'STABLE_BUSINESS_CODE',
        requestId: 'req_form',
      },
    ])
  })

  it('clears the edited field and stale form errors while retaining other input and field errors', () => {
    const submitting = beginFormSubmit(createFormState(initialValues))
    const failed = failFormSubmit(
      submitting,
      adminError('INVALID_ARGUMENT', [
        { path: 'displayName', code: 'REQUIRED' },
        { path: 'email', code: 'INVALID_FORMAT' },
        { path: 'unknown', code: 'INVALID' },
      ]),
      fields,
      submitting.revision
    )
    const edited = editFormField(failed, 'displayName', 'Grace')

    expect(edited).toEqual({
      status: 'editing',
      revision: 2,
      values: { displayName: 'Grace', email: 'ada@example.test' },
      fieldErrors: { email: ['INVALID_FORMAT'] },
      formErrors: [],
    })
    expect(failed.values).toEqual(initialValues)
    expect(failed.fieldErrors).toEqual({
      displayName: ['REQUIRED'],
      email: ['INVALID_FORMAT'],
    })
  })

  it('ignores an out-of-order response after editing or a newer submit', () => {
    const first = beginFormSubmit(createFormState(initialValues))
    const edited = editFormField(first, 'displayName', 'Grace')
    const second = beginFormSubmit(edited)

    expect(succeedFormSubmit(edited, first.revision)).toBe(edited)
    expect(
      failFormSubmit(second, adminError('UNKNOWN'), fields, first.revision)
    ).toBe(second)
    expect(succeedFormSubmit(second, second.revision).status).toBe('success')
  })

  it('rejects unsafe or undeclared form field names', () => {
    const submitting = beginFormSubmit(createFormState(initialValues))

    expect(() =>
      failFormSubmit(
        submitting,
        adminError('INVALID_ARGUMENT', [
          { path: '__proto__', code: 'INVALID' },
        ]),
        ['__proto__'] as unknown as readonly (keyof Values)[],
        submitting.revision
      )
    ).toThrow('Invalid declared form field: __proto__')
  })

  it('maps a forward-compatible unknown error code to the safe error state', () => {
    const submitting = beginFormSubmit(createFormState(initialValues))
    const error = {
      ...adminError('UNKNOWN'),
      code: 'FUTURE_CONTRACT_CODE',
    } as unknown as AdminError

    expect(
      failFormSubmit(submitting, error, fields, submitting.revision).status
    ).toBe('error')
  })
})
