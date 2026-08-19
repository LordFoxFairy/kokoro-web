import { describe, expect, it } from 'vitest'
import { parseAdminEnv } from '../env'
import { authorizeDevelopmentCredentials } from './development-credentials'

const baseEnv = {
  NODE_ENV: 'test',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  ADMIN_DATA_SOURCE: 'fixture',
} as const

const enabledEnv = parseAdminEnv({
  ...baseEnv,
  AUTH_DEV_CREDENTIALS_ENABLED: 'true',
  AUTH_SECRET: 'a-development-secret-with-32-characters',
  AUTH_DEV_ACCOUNT: 'admin',
  AUTH_DEV_PASSWORD: 'local-secret',
  AUTH_DEV_USER_ID: 'usr_ada',
  AUTH_DEV_DISPLAY_NAME: 'Ada Chen',
  AUTH_DEV_EMAIL: 'ada@example.test',
  AUTH_DEV_CAPABILITIES: 'dashboard.read, users.read, dashboard.read',
})

describe('authorizeDevelopmentCredentials', () => {
  it('returns the configured server-side identity for matching credentials', () => {
    expect(
      authorizeDevelopmentCredentials(
        { account: 'admin', password: 'local-secret' },
        enabledEnv
      )
    ).toEqual({
      id: 'usr_ada',
      name: 'Ada Chen',
      displayName: 'Ada Chen',
      email: 'ada@example.test',
      capabilities: ['dashboard.read', 'users.read'],
    })
  })

  it('ignores Auth.js transport fields while validating credentials', () => {
    expect(
      authorizeDevelopmentCredentials(
        {
          account: 'admin',
          password: 'local-secret',
          csrfToken: 'transport-only',
          callbackUrl: '/users',
          redirect: 'false',
        },
        enabledEnv
      )
    ).toMatchObject({ id: 'usr_ada' })
  })

  it.each([
    { account: 'wrong', password: 'local-secret' },
    { account: 'admin', password: 'wrong' },
    { account: '', password: 'local-secret' },
    { account: 'admin' },
    null,
  ])('returns null for invalid credentials %#', (credentials) => {
    expect(authorizeDevelopmentCredentials(credentials, enabledEnv)).toBeNull()
  })

  it('returns null when the development provider is not enabled', () => {
    expect(
      authorizeDevelopmentCredentials(
        { account: 'admin', password: 'local-secret' },
        parseAdminEnv(baseEnv)
      )
    ).toBeNull()
  })
})
