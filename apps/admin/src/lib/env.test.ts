import { describe, expect, it } from 'vitest'
import { parseAdminEnv, pickPublicAdminEnv } from './env'

const baseEnv = {
  NODE_ENV: 'development',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  ADMIN_DATA_SOURCE: 'fixture',
} as const

describe('parseAdminEnv', () => {
  it.each(['development', 'test'] as const)(
    'allows fixture mode without backend configuration in %s',
    (nodeEnv) => {
      expect(parseAdminEnv({ ...baseEnv, NODE_ENV: nodeEnv })).toEqual({
        ...baseEnv,
        NODE_ENV: nodeEnv,
      })
    }
  )

  it.each(['development', 'test'] as const)(
    'allows configured RPC mode in %s',
    (nodeEnv) => {
      expect(
        parseAdminEnv({
          ...baseEnv,
          NODE_ENV: nodeEnv,
          ADMIN_DATA_SOURCE: 'rpc',
          IAM_RPC_URL: 'https://iam.example.test/connect',
        })
      ).toMatchObject({
        ADMIN_DATA_SOURCE: 'rpc',
        IAM_RPC_URL: 'https://iam.example.test/connect',
      })
    }
  )

  it.each(['development', 'test'] as const)(
    'requires an IAM endpoint when RPC mode is selected in %s',
    (nodeEnv) => {
      expect(() =>
        parseAdminEnv({
          ...baseEnv,
          NODE_ENV: nodeEnv,
          ADMIN_DATA_SOURCE: 'rpc',
        })
      ).toThrow('IAM_RPC_URL is required when ADMIN_DATA_SOURCE is rpc')
    }
  )

  it('accepts a complete production configuration', () => {
    expect(
      parseAdminEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        ADMIN_DATA_SOURCE: 'rpc',
        AUTH_SECRET: 'a-production-secret-with-32-characters',
        IAM_RPC_URL: 'https://iam.example.test',
      })
    ).toMatchObject({ NODE_ENV: 'production', ADMIN_DATA_SOURCE: 'rpc' })
  })

  it('rejects fixture mode in production', () => {
    expect(() =>
      parseAdminEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        AUTH_SECRET: 'a-production-secret-with-32-characters',
      })
    ).toThrow('ADMIN_DATA_SOURCE must be rpc in production')
  })

  it.each([undefined, '', 'short'])(
    'rejects production AUTH_SECRET=%s',
    (secret) => {
      expect(() =>
        parseAdminEnv({
          ...baseEnv,
          NODE_ENV: 'production',
          ADMIN_DATA_SOURCE: 'rpc',
          AUTH_SECRET: secret,
          IAM_RPC_URL: 'https://iam.example.test',
        })
      ).toThrow('AUTH_SECRET must contain at least 32 characters in production')
    }
  )

  it.each([
    '                                ',
    'replace-with-at-least-32-characters',
  ])('rejects unsafe production AUTH_SECRET placeholder %s', (secret) => {
    expect(() =>
      parseAdminEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        ADMIN_DATA_SOURCE: 'rpc',
        AUTH_SECRET: secret,
        IAM_RPC_URL: 'https://iam.example.test',
      })
    ).toThrow('AUTH_SECRET must contain at least 32 characters in production')
  })

  it.each(['ftp://iam.example.test', 'file:///tmp/iam.sock', 'not-a-url'])(
    'rejects non-HTTP IAM_RPC_URL %s',
    (iamUrl) => {
      expect(() =>
        parseAdminEnv({
          ...baseEnv,
          ADMIN_DATA_SOURCE: 'rpc',
          IAM_RPC_URL: iamUrl,
        })
      ).toThrow()
    }
  )

  it.each([
    ['NODE_ENV', 'preview'],
    ['ADMIN_DATA_SOURCE', 'memory'],
    ['NEXT_PUBLIC_APP_URL', 'ftp://admin.example.test'],
  ] as const)('rejects invalid %s', (key, value) => {
    expect(() => parseAdminEnv({ ...baseEnv, [key]: value })).toThrow()
  })

  it.each([
    'https://user:password@admin.example.test',
    'https://admin.example.test/path',
    'https://admin.example.test?source=test',
    'https://admin.example.test#fragment',
  ])('rejects NEXT_PUBLIC_APP_URL that is not a pure origin: %s', (appUrl) => {
    expect(() =>
      parseAdminEnv({ ...baseEnv, NEXT_PUBLIC_APP_URL: appUrl })
    ).toThrow('Must be an HTTP(S) origin without credentials, path or query')
  })

  it('strips unknown keys from full environment inputs', () => {
    expect(
      parseAdminEnv({
        ...baseEnv,
        PATH: '/example/bin',
        UNRELATED_SECRET: 'must-not-survive',
      })
    ).toEqual(baseEnv)
  })

  it('returns a frozen, runtime-branded configuration', async () => {
    const { isParsedAdminEnv } = await import('./env')
    const parsed = parseAdminEnv(baseEnv)

    expect(isParsedAdminEnv(parsed)).toBe(true)
    expect(isParsedAdminEnv({ ...parsed })).toBe(false)
    expect(Object.isFrozen(parsed)).toBe(true)
  })
})

describe('pickPublicAdminEnv', () => {
  it('returns only appUrl and never exposes IAM or Auth.js configuration', () => {
    const env = parseAdminEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      ADMIN_DATA_SOURCE: 'rpc',
      AUTH_SECRET: 'a-production-secret-with-32-characters',
      IAM_RPC_URL: 'https://iam.example.test',
    })

    expect(pickPublicAdminEnv(env)).toEqual({
      appUrl: 'http://127.0.0.1:3100',
    })
    expect(Object.keys(pickPublicAdminEnv(env))).toEqual(['appUrl'])
  })
})
