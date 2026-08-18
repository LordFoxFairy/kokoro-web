import { describe, expect, it } from 'vitest'
import { sanitizeLogContext } from './logging'

describe('sanitizeLogContext', () => {
  it('returns only approved scalar fields in a frozen object', () => {
    const context = sanitizeLogContext({
      requestId: 'req_123',
      method: 'ListUsers',
      code: 'OK',
      status: 200,
      durationMs: 42,
      scopeType: 'organization',
      targetType: 'user',
      count: 3,
      arbitrary: 'drop me',
    })

    expect(context).toEqual({
      requestId: 'req_123',
      method: 'ListUsers',
      code: 'OK',
      status: 200,
      durationMs: 42,
      scopeType: 'organization',
      targetType: 'user',
      count: 3,
    })
    expect(Object.isFrozen(context)).toBe(true)
  })

  it.each([
    'token',
    'TOKEN',
    'Password',
    'secret',
    'cookie',
    'Authorization',
    'email',
    'IP',
    'pageToken',
    'message',
    'stack',
  ])('never exposes sensitive field %s', (field) => {
    expect(sanitizeLogContext({ [field]: 'sensitive' })).toEqual({})
  })

  it('does not recursively inspect objects or accept arrays', () => {
    expect(
      sanitizeLogContext({
        requestId: { token: 'nested' },
        method: ['ListUsers'],
        status: { value: 200 },
        durationMs: [12],
        nested: { requestId: 'req_nested', authorization: 'secret' },
      })
    ).toEqual({})
    expect(sanitizeLogContext([{ requestId: 'req_array' }])).toEqual({})
  })

  it('ignores symbols, inherited fields, and accessors without invoking them', () => {
    const symbol = Symbol('token')
    const prototype = { requestId: 'req_inherited', token: 'inherited' }
    const input = Object.create(prototype) as Record<PropertyKey, unknown>
    let getterCalls = 0

    Object.defineProperties(input, {
      method: { value: 'GetUser', enumerable: true },
      requestId: {
        enumerable: true,
        get() {
          getterCalls += 1
          throw new Error('must not be read')
        },
      },
    })
    input[symbol] = 'sensitive'

    expect(sanitizeLogContext(input)).toEqual({ method: 'GetUser' })
    expect(getterCalls).toBe(0)

    const nullPrototype = Object.assign(Object.create(null), {
      requestId: 'req_null_proto',
    })
    expect(sanitizeLogContext(nullPrototype)).toEqual({
      requestId: 'req_null_proto',
    })

    const hostileProxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('hostile descriptor trap')
        },
      }
    )
    expect(() => sanitizeLogContext(hostileProxy)).not.toThrow()
    expect(sanitizeLogContext(hostileProxy)).toEqual({})
  })

  it('accepts non-negative safe integer boundaries and drops invalid numbers', () => {
    expect(
      sanitizeLogContext({
        status: 0,
        durationMs: Number.MAX_SAFE_INTEGER,
        count: 0,
      })
    ).toEqual({
      status: 0,
      durationMs: Number.MAX_SAFE_INTEGER,
      count: 0,
    })

    expect(
      sanitizeLogContext({ status: -1, durationMs: 1.5, count: NaN })
    ).toEqual({})
    expect(
      sanitizeLogContext({
        status: Infinity,
        durationMs: Number.MAX_SAFE_INTEGER + 1,
        count: -Infinity,
      })
    ).toEqual({})
  })

  it('drops malformed, multiline and oversized string values', () => {
    expect(
      sanitizeLogContext({
        requestId: 'token with spaces',
        method: 'ListUsers\nAuthorization: secret',
        code: 'not_uppercase',
        scopeType: 'organization<script>',
        targetType: `user${'x'.repeat(128)}`,
      })
    ).toEqual({})
  })

  it('does not throw for a revoked Proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() => sanitizeLogContext(proxy)).not.toThrow()
    expect(sanitizeLogContext(proxy)).toEqual({})
  })

  it('returns a frozen empty object for non-object inputs', () => {
    for (const input of [null, undefined, 'text', 42, true, Symbol('input')]) {
      const context = sanitizeLogContext(input)
      expect(context).toEqual({})
      expect(Object.isFrozen(context)).toBe(true)
    }
  })
})
