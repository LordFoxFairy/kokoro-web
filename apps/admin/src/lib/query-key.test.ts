import { describe, expect, it } from 'vitest'
import { createQueryKey } from './query-key'

function input() {
  return {
    identityId: 'identity_42',
    scope: { type: 'site', id: 'site_7' },
    contractVersion: 'iam.v1',
    domain: 'user',
    operation: 'list',
    params: {
      query: 'Ada',
      filters: { status: ['active', 'invited'], role: 'owner' },
      pageSize: 25,
    },
  }
}

describe('Admin query keys', () => {
  it('contains every cache isolation boundary and canonical parameters', () => {
    expect(createQueryKey(input())).toEqual([
      'kokoro.admin.query.v1',
      'iam.v1',
      'identity_42',
      'site',
      'site_7',
      'user',
      'list',
      '{"filters":{"role":"owner","status":["active","invited"]},"pageSize":25,"query":"Ada"}',
    ])
  })

  it('is deterministic when object insertion order differs', () => {
    const first = input()
    const second = {
      ...input(),
      params: {
        pageSize: 25,
        filters: { role: 'owner', status: ['active', 'invited'] },
        query: 'Ada',
      },
    }

    expect(createQueryKey(first)).toEqual(createQueryKey(second))
  })

  it.each([
    ['identity', { identityId: 'identity_99' }],
    ['scope type', { scope: { type: 'organization', id: 'site_7' } }],
    ['scope id', { scope: { type: 'site', id: 'site_8' } }],
    ['contract version', { contractVersion: 'iam.v2' }],
    ['domain', { domain: 'organization' }],
    ['operation', { operation: 'detail' }],
    ['filter', { params: { ...input().params, query: 'Grace' } }],
  ])('does not collide across a different %s', (_label, change) => {
    const original = input()
    const changed = { ...original, ...change }

    expect(createQueryKey(changed)).not.toEqual(createQueryKey(original))
  })

  it.each([
    'token',
    'accessToken',
    'pageToken',
    'password',
    'cookie',
    'authorization',
    'clientSecret',
    'apiKey',
    'credential',
  ])('rejects the sensitive parameter field %s', (field) => {
    expect(() =>
      createQueryKey({
        ...input(),
        params: { filters: { [field]: 'sensitive-value' } },
      })
    ).toThrowError(`sensitive query parameter field: filters.${field}`)
  })

  it('treats an opaque cursor as a scalar and never interprets it', () => {
    const opaqueCursor = 'eyJvZmZzZXQiOjI1fQ==.opaque'
    const key = createQueryKey({
      ...input(),
      params: { cursor: opaqueCursor, pageSize: 25 },
    })

    expect(key.at(-1)).toBe(`{"cursor":"${opaqueCursor}","pageSize":25}`)
  })

  it('canonicalizes platform scope without accepting a caller-provided id', () => {
    expect(
      createQueryKey({ ...input(), scope: { type: 'platform' } }).slice(3, 5)
    ).toEqual(['platform', '-'])
    expect(() =>
      createQueryKey({
        ...input(),
        scope: { type: 'platform', id: 'site_7' },
      })
    ).toThrow('scope.id is not supported')
    expect(() =>
      createQueryKey({ ...input(), scope: { type: 'tenant', id: 'tenant_1' } })
    ).toThrow('unsupported scope.type: tenant')
  })

  it('rejects accessors without invoking them', () => {
    let getterCalls = 0
    const params = Object.defineProperty({}, 'query', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'tenant-A'
      },
    })

    expect(() => createQueryKey({ ...input(), params })).toThrow(
      'params.query must be an own data property'
    )
    expect(getterCalls).toBe(0)
  })

  it('rejects nested array accessors without invoking them', () => {
    let getterCalls = 0
    const values: string[] = []
    Object.defineProperty(values, 0, {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'tenant-A'
      },
    })
    values.length = 1

    expect(() => createQueryKey({ ...input(), params: { values } })).toThrow(
      'params.values[0] must be an own data property'
    )
    expect(getterCalls).toBe(0)
  })

  it('rejects a revoked nested array Proxy with a stable error', () => {
    const { proxy, revoke } = Proxy.revocable([], {})
    revoke()

    expect(() =>
      createQueryKey({ ...input(), params: { values: proxy } })
    ).toThrow('params.values must be stable JSON data')
  })

  it.each([
    [null, 'input must be an object'],
    [{}, 'identityId must be a non-empty identifier'],
    [
      { ...input(), identityId: ' ' },
      'identityId must be a non-empty identifier',
    ],
    [
      { ...input(), scope: { type: 'site', id: '' } },
      'scope.id must be a non-empty identifier',
    ],
    [
      { ...input(), params: { limit: Number.NaN } },
      'params.limit must be a finite number',
    ],
    [
      { ...input(), params: { createdAt: new Date() } },
      'params.createdAt must be a plain object',
    ],
    [
      { ...input(), params: { value: undefined } },
      'params.value is not JSON-compatible',
    ],
  ])('rejects malformed input %#', (candidate, message) => {
    expect(() => createQueryKey(candidate)).toThrowError(message)
  })

  it('rejects cyclic parameters', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(() => createQueryKey({ ...input(), params: cyclic })).toThrowError(
      'params.self contains a cycle'
    )
  })

  it('rejects sparse arrays rather than assigning an ambiguous key', () => {
    const sparse = Array<string>(1)

    expect(() =>
      createQueryKey({ ...input(), params: { values: sparse } })
    ).toThrowError('params.values[0] is not JSON-compatible')
  })
})
