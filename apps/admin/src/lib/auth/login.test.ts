import { describe, expect, it, vi } from 'vitest'
import { performCredentialLogin } from './login'

const appOrigin = 'https://admin.kokoro.test'

describe('performCredentialLogin', () => {
  it('rejects invalid fields before calling Auth.js', async () => {
    const signIn = vi.fn()

    await expect(
      performCredentialLogin(
        { account: '', password: '', callbackUrl: '/users' },
        { appOrigin, credentialsEnabled: true, signIn }
      )
    ).resolves.toEqual({
      ok: false,
      code: 'AUTH_INVALID_INPUT',
      fieldErrors: {
        account: ['请输入账号'],
        password: ['请输入密码'],
      },
    })
    expect(signIn).not.toHaveBeenCalled()
  })

  it('fails closed without calling Auth.js when credentials are disabled', async () => {
    const signIn = vi.fn()

    await expect(
      performCredentialLogin(
        { account: 'admin', password: 'secret', callbackUrl: '/users' },
        { appOrigin, credentialsEnabled: false, signIn }
      )
    ).resolves.toEqual({
      ok: false,
      code: 'AUTH_UNAVAILABLE',
      fieldErrors: {},
    })
    expect(signIn).not.toHaveBeenCalled()
  })

  it('calls the isolated development provider and returns a safe callback', async () => {
    const signIn = vi.fn(async () => undefined)

    await expect(
      performCredentialLogin(
        {
          account: 'admin',
          password: 'secret',
          callbackUrl: '/users?page=2#results',
        },
        { appOrigin, credentialsEnabled: true, signIn }
      )
    ).resolves.toEqual({
      ok: true,
      redirectTo: '/users?page=2#results',
    })
    expect(signIn).toHaveBeenCalledWith('kokoro-dev-credentials', {
      account: 'admin',
      password: 'secret',
      redirect: false,
      redirectTo: '/users?page=2#results',
    })
  })

  it('reduces an unsafe callback to the Admin root', async () => {
    const signIn = vi.fn(async () => undefined)

    await expect(
      performCredentialLogin(
        {
          account: 'admin',
          password: 'secret',
          callbackUrl: 'https://evil.test/phish',
        },
        { appOrigin, credentialsEnabled: true, signIn }
      )
    ).resolves.toMatchObject({ ok: true, redirectTo: '/' })
  })

  it.each([
    [{ type: 'CredentialsSignin' }, 'AUTH_INVALID_CREDENTIALS'],
    [{ type: 'Configuration' }, 'AUTH_UNAVAILABLE'],
    [new Error('backend detail must not escape'), 'AUTH_UNAVAILABLE'],
  ] as const)('maps Auth.js failures to %s', async (error, code) => {
    const signIn = vi.fn(async () => {
      throw error
    })

    await expect(
      performCredentialLogin(
        { account: 'admin', password: 'secret', callbackUrl: '/users' },
        { appOrigin, credentialsEnabled: true, signIn }
      )
    ).resolves.toEqual({ ok: false, code, fieldErrors: {} })
  })
})
