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

  it.each(['development', 'test'] as const)(
    'allows explicitly configured development credentials in %s',
    (nodeEnv) => {
      expect(
        parseAdminEnv({
          ...baseEnv,
          NODE_ENV: nodeEnv,
          AUTH_DEV_CREDENTIALS_ENABLED: 'true',
          AUTH_SECRET: 'a-development-secret-with-32-characters',
          AUTH_DEV_ACCOUNT: 'admin',
          AUTH_DEV_PASSWORD: 'local-secret',
          AUTH_DEV_USER_ID: 'usr_ada',
          AUTH_DEV_DISPLAY_NAME: 'Ada Chen',
          AUTH_DEV_EMAIL: 'ada@example.test',
          AUTH_DEV_CAPABILITIES: 'dashboard.read,users.read',
        })
      ).toMatchObject({
        AUTH_DEV_CREDENTIALS_ENABLED: 'true',
        AUTH_DEV_ACCOUNT: 'admin',
        AUTH_DEV_USER_ID: 'usr_ada',
      })
    }
  )

  it('rejects incomplete enabled development credentials', () => {
    expect(() =>
      parseAdminEnv({
        ...baseEnv,
        AUTH_DEV_CREDENTIALS_ENABLED: 'true',
        AUTH_DEV_ACCOUNT: 'admin',
      })
    ).toThrow('Development credentials require all AUTH_DEV fields')
  })

  it('requires AUTH_SECRET when development credentials are enabled', () => {
    expect(() =>
      parseAdminEnv({
        ...baseEnv,
        AUTH_DEV_CREDENTIALS_ENABLED: 'true',
        AUTH_DEV_ACCOUNT: 'admin',
        AUTH_DEV_PASSWORD: 'local-secret',
        AUTH_DEV_USER_ID: 'usr_ada',
        AUTH_DEV_DISPLAY_NAME: 'Ada Chen',
        AUTH_DEV_EMAIL: 'ada@example.test',
        AUTH_DEV_CAPABILITIES: 'dashboard.read,users.read',
      })
    ).toThrow(
      'AUTH_SECRET is required when development credentials are enabled'
    )
  })

  it('rejects development credential values unless explicitly enabled', () => {
    expect(() =>
      parseAdminEnv({
        ...baseEnv,
        AUTH_DEV_ACCOUNT: 'admin',
      })
    ).toThrow('Development credentials must be explicitly enabled')
  })

  it('rejects all development credential configuration in production', () => {
    expect(() =>
      parseAdminEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        ADMIN_DATA_SOURCE: 'rpc',
        AUTH_SECRET: 'a-production-secret-with-32-characters',
        IAM_RPC_URL: 'https://iam.example.test',
        AUTH_DEV_CREDENTIALS_ENABLED: 'true',
        AUTH_DEV_ACCOUNT: 'admin',
        AUTH_DEV_PASSWORD: 'local-secret',
        AUTH_DEV_USER_ID: 'usr_ada',
        AUTH_DEV_DISPLAY_NAME: 'Ada Chen',
        AUTH_DEV_EMAIL: 'ada@example.test',
        AUTH_DEV_CAPABILITIES: 'dashboard.read,users.read',
      })
    ).toThrow('Development credentials are forbidden in production')
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
