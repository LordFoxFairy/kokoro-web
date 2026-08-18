import type { AdminError, AdminErrorCode, FieldViolation } from './view-models'

type StringField<Values extends object> = Extract<keyof Values, string>

export type FormFieldErrors<Field extends string> = Readonly<
  Partial<Record<Field, readonly string[]>>
>

export type FormError = {
  readonly code: AdminErrorCode
  readonly businessCode?: string
  readonly violationCode?: string
  readonly requestId: string
}

type FormStateData<Values extends object> = {
  readonly revision: number
  readonly values: Values
  readonly fieldErrors: FormFieldErrors<StringField<Values>>
  readonly formErrors: readonly FormError[]
}

export type FormState<Values extends object> = FormStateData<Values> &
  (
    | { readonly status: 'idle' }
    | { readonly status: 'editing' }
    | { readonly status: 'submitting' }
    | { readonly status: 'success' }
    | { readonly status: 'error' }
    | { readonly status: 'conflict' }
    | { readonly status: 'forbidden' }
  )

function emptyFieldErrors<Values extends object>(): FormFieldErrors<
  StringField<Values>
> {
  return {} as FormFieldErrors<StringField<Values>>
}

export function createFormState<Values extends object>(
  values: Values
): FormState<Values> {
  return {
    status: 'idle',
    revision: 0,
    values,
    fieldErrors: emptyFieldErrors<Values>(),
    formErrors: [],
  }
}

export function editFormField<
  Values extends object,
  Field extends StringField<Values>,
>(
  state: FormState<Values>,
  field: Field,
  value: Values[Field]
): FormState<Values> {
  const fieldErrors: Partial<Record<StringField<Values>, readonly string[]>> =
    {}

  for (const candidate of Object.keys(
    state.fieldErrors
  ) as StringField<Values>[]) {
    const errors = state.fieldErrors[candidate]
    if (candidate !== field && errors !== undefined) {
      fieldErrors[candidate] = errors
    }
  }

  return {
    status: 'editing',
    revision: state.revision + 1,
    values: { ...state.values, [field]: value },
    fieldErrors,
    formErrors: [],
  }
}

export function beginFormSubmit<Values extends object>(
  state: FormState<Values>
): FormState<Values> {
  if (state.status === 'submitting') return state

  return {
    status: 'submitting',
    revision: state.revision + 1,
    values: state.values,
    fieldErrors: emptyFieldErrors<Values>(),
    formErrors: [],
  }
}

export function succeedFormSubmit<Values extends object>(
  state: FormState<Values>,
  revision: number
): FormState<Values> {
  if (state.status !== 'submitting' || state.revision !== revision) return state

  return {
    status: 'success',
    revision: state.revision,
    values: state.values,
    fieldErrors: emptyFieldErrors<Values>(),
    formErrors: [],
  }
}

function resultStatus(
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

function toFormError(error: AdminError, violation?: FieldViolation): FormError {
  return {
    code: error.code,
    businessCode: error.businessCode,
    violationCode: violation?.code,
    requestId: error.requestId,
  }
}

export function failFormSubmit<
  Values extends object,
  Field extends StringField<Values>,
>(
  state: FormState<Values>,
  error: AdminError,
  declaredFields: readonly Field[],
  revision: number
): FormState<Values> {
  if (state.status !== 'submitting' || state.revision !== revision) return state

  const declared = new Set<string>()
  for (const field of declaredFields) {
    if (
      !Object.prototype.hasOwnProperty.call(state.values, field) ||
      field === '__proto__' ||
      field === 'prototype' ||
      field === 'constructor'
    ) {
      throw new Error(`Invalid declared form field: ${field}`)
    }
    declared.add(field)
  }
  const fieldErrors: Partial<Record<StringField<Values>, readonly string[]>> =
    Object.create(null) as Partial<
      Record<StringField<Values>, readonly string[]>
    >
  const formErrors: FormError[] = []

  for (const violation of error.fieldViolations) {
    if (!declared.has(violation.path)) {
      formErrors.push(toFormError(error, violation))
      continue
    }

    const field = violation.path as StringField<Values>
    fieldErrors[field] = [...(fieldErrors[field] ?? []), violation.code]
  }

  if (error.fieldViolations.length === 0) {
    formErrors.push(toFormError(error))
  }

  return {
    status: resultStatus(error.code),
    revision: state.revision,
    values: state.values,
    fieldErrors,
    formErrors,
  }
}
