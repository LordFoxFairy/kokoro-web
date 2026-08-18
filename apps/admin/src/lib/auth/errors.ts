export const AUTH_FAILURE_CATEGORIES = [
  'invalid_credentials',
  'disabled',
  'deleted',
  'no_admin_access',
  'rate_limited',
  'unavailable',
  'unknown',
] as const

export type AuthFailureCategory = (typeof AUTH_FAILURE_CATEGORIES)[number]

export interface InternalAuthFailure {
  readonly category: AuthFailureCategory
  readonly requestId: string
  /** Private transport detail. It must never be copied to presentation state. */
  readonly message?: string
}

export interface PublicLoginError {
  readonly code: 'SIGN_IN_FAILED'
  readonly message: '登录未成功。'
  readonly recovery:
    | '请确认登录信息后重试。'
    | '请求较为频繁，请稍后重试。'
    | '登录服务暂时不可用，请稍后重试。'
  readonly requestId: string
}

const PUBLIC_MESSAGE = '登录未成功。' as const

const recoveryByCategory = {
  invalid_credentials: '请确认登录信息后重试。',
  disabled: '请确认登录信息后重试。',
  deleted: '请确认登录信息后重试。',
  no_admin_access: '请确认登录信息后重试。',
  rate_limited: '请求较为频繁，请稍后重试。',
  unavailable: '登录服务暂时不可用，请稍后重试。',
  unknown: '请确认登录信息后重试。',
} as const satisfies Record<AuthFailureCategory, PublicLoginError['recovery']>

export function mapLoginFailure({
  category,
  requestId,
}: InternalAuthFailure): PublicLoginError {
  return {
    code: 'SIGN_IN_FAILED',
    message: PUBLIC_MESSAGE,
    recovery: recoveryByCategory[category],
    requestId,
  }
}
