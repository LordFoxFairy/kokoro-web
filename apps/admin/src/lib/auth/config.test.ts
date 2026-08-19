import { describe, expect, it } from 'vitest'
import { parseAdminEnv } from '../env'
import { createAuthConfig } from './config'

const baseEnv = {
  NODE_ENV: 'test',
  NEXT_PUBLIC_APP_URL: 'https://admin.kokoro.test',
  ADMIN_DATA_SOURCE: 'fixture',
} as const

const enabledEnv = parseAdminEnv({
  ...baseEnv,
  AUTH_SECRET: 'a-development-secret-with-32-characters',
  AUTH_DEV_CREDENTIALS_ENABLED: 'true',
  AUTH_DEV_ACCOUNT: 'admin',
  AUTH_DEV_PASSWORD: 'local-secret',
  AUTH_DEV_USER_ID: 'usr_ada',
  AUTH_DEV_DISPLAY_NAME: 'Ada Chen',
  AUTH_DEV_EMAIL: 'ada@example.test',
  AUTH_DEV_CAPABILITIES: 'dashboard.read,users.read',
})

type Callback = (input: Record<string, unknown>) => unknown

describe('createAuthConfig', () => {
  it('registers no Credentials provider unless development auth is enabled', () => {
    expect(createAuthConfig(parseAdminEnv(baseEnv)).providers).toEqual([])

    const production = parseAdminEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      ADMIN_DATA_SOURCE: 'rpc',
      AUTH_SECRET: 'a-production-secret-with-32-characters',
      IAM_RPC_URL: 'https://iam.example.test',
    })
    expect(createAuthConfig(production).providers).toEqual([])
  })

  it('authorizes only the explicitly configured development credentials', async () => {
    const provider = createAuthConfig(enabledEnv).providers[0] as unknown as {
      id: string
      options: {
        id: string
        authorize: (
          credentials: Record<string, unknown>,
          request: Request
        ) => unknown
      }
    }

    expect(provider.id).toBe('credentials')
    expect(provider.options.id).toBe('kokoro-dev-credentials')
    await expect(
      Promise.resolve(
        provider.options.authorize(
          { account: 'admin', password: 'local-secret' },
          new Request('https://admin.kokoro.test/api/auth/callback/credentials')
        )
      )
    ).resolves.toMatchObject({ id: 'usr_ada', email: 'ada@example.test' })
    await expect(
      Promise.resolve(
        provider.options.authorize(
          { account: 'admin', password: 'wrong' },
          new Request('https://admin.kokoro.test/api/auth/callback/credentials')
        )
      )
    ).resolves.toBeNull()
  })

  it('projects development identity through JWT and Session callbacks', async () => {
    const config = createAuthConfig(enabledEnv)
    const jwt = config.callbacks?.jwt as unknown as Callback
    const session = config.callbacks?.session as unknown as Callback
    const user = {
      id: 'usr_ada',
      name: 'Ada Chen',
      displayName: 'Ada Chen',
      email: 'ada@example.test',
      capabilities: ['dashboard.read', 'users.read'],
    }

    const token = await jwt({ token: { incidental: 'removed' }, user })
    expect(token).toEqual({
      sub: 'usr_ada',
      name: 'Ada Chen',
      email: 'ada@example.test',
      displayName: 'Ada Chen',
      capabilities: ['dashboard.read', 'users.read'],
    })

    await expect(
      session({
        session: {
          user: { name: null, email: null, image: null },
          expires: '2099-08-19T13:00:00.000Z',
        },
        token,
      })
    ).resolves.toEqual({
      user: {
        id: 'usr_ada',
        name: 'Ada Chen',
        displayName: 'Ada Chen',
        email: 'ada@example.test',
        image: null,
        capabilities: ['dashboard.read', 'users.read'],
      },
      expires: '2099-08-19T13:00:00.000Z',
    })
  })

  it.each([
    ['/login', null, true],
    ['/api/auth/session', null, true],
    [
      '/users',
      {
        user: {
          id: 'usr_ada',
          name: 'Ada Chen',
          displayName: 'Ada Chen',
          email: 'ada@example.test',
          image: null,
          capabilities: ['users.read'],
        },
        expires: '2099-08-19T13:00:00.000Z',
      },
      true,
    ],
  ])(
    'authorizes %s with the expected session boundary',
    async (pathname, auth, expected) => {
      const authorized = createAuthConfig(enabledEnv).callbacks
        ?.authorized as unknown as Callback

      await expect(
        Promise.resolve(
          authorized({ request: { nextUrl: { pathname } }, auth })
        )
      ).resolves.toBe(expected)
    }
  )

  it('redirects an anonymous protected request with a path-only callback', () => {
    const authorized = createAuthConfig(enabledEnv).callbacks
      ?.authorized as unknown as Callback
    const result = authorized({
      request: {
        nextUrl: { pathname: '/users', search: '?page=2' },
      },
      auth: null,
    })

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).headers.get('location')).toBe(
      'https://admin.kokoro.test/login?callbackUrl=%2Fusers%3Fpage%3D2'
    )
  })

  it.each([
    ['/users?page=2', 'https://admin.kokoro.test/users?page=2'],
    ['https://evil.test/users', 'https://admin.kokoro.test/'],
    ['/api/auth/session', 'https://admin.kokoro.test/'],
  ])('returns a safe absolute redirect for %s', async (url, expected) => {
    const redirect = createAuthConfig(enabledEnv).callbacks
      ?.redirect as unknown as Callback

    await expect(
      Promise.resolve(
        redirect({ url, baseUrl: 'https://untrusted-proxy.test' })
      )
    ).resolves.toBe(expected)
  })
})
