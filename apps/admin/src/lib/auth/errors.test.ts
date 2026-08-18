import { describe, expect, it } from 'vitest'
import {
  AUTH_FAILURE_CATEGORIES,
  mapLoginFailure,
  type AuthFailureCategory,
} from './errors'

const accountSensitiveCategories = [
  'invalid_credentials',
  'disabled',
  'deleted',
  'no_admin_access',
  'unknown',
] as const satisfies readonly AuthFailureCategory[]

describe('mapLoginFailure', () => {
  it.each(AUTH_FAILURE_CATEGORIES)(
    'uses the same public code and message for %s',
    (category) => {
      const result = mapLoginFailure({
        category,
        requestId: `req_${category}`,
        message: `private backend detail for ${category}`,
      })

      expect(result.code).toBe('SIGN_IN_FAILED')
      expect(result.message).toBe('登录未成功。')
      expect(result.requestId).toBe(`req_${category}`)
      expect(result).not.toHaveProperty('category')
      expect(result).not.toHaveProperty('backendMessage')
      expect(result).not.toHaveProperty('internalMessage')
      expect(result).not.toHaveProperty('details')
    }
  )

  it('does not enumerate credential, lifecycle, or admin-access state', () => {
    const publicErrors = accountSensitiveCategories.map((category) =>
      mapLoginFailure({ category, requestId: 'req_shared' })
    )

    expect(new Set(publicErrors.map(({ message }) => message))).toEqual(
      new Set(['登录未成功。'])
    )
    expect(new Set(publicErrors.map(({ recovery }) => recovery))).toEqual(
      new Set(['请确认登录信息后重试。'])
    )
  })

  it('only distinguishes safe recovery advice for rate limiting and availability', () => {
    expect(
      mapLoginFailure({ category: 'rate_limited', requestId: 'req_rate' })
        .recovery
    ).toBe('请求较为频繁，请稍后重试。')
    expect(
      mapLoginFailure({ category: 'unavailable', requestId: 'req_unavailable' })
        .recovery
    ).toBe('登录服务暂时不可用，请稍后重试。')
  })

  it('retains correlation without exposing a backend message', () => {
    const result = mapLoginFailure({
      category: 'disabled',
      requestId: 'req_correlation_42',
      message: 'account disabled by policy secret-policy-name',
    })

    expect(result).toEqual({
      code: 'SIGN_IN_FAILED',
      message: '登录未成功。',
      recovery: '请确认登录信息后重试。',
      requestId: 'req_correlation_42',
    })
    expect(JSON.stringify(result)).not.toContain('secret-policy-name')
  })
})
