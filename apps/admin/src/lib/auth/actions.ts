'use server'

import { signIn, signOut } from '@/auth'
import { getAdminEnv } from '@/lib/server/env'
import {
  performCredentialLogin,
  type LoginInput,
  type LoginResult,
} from './login'

export async function loginAction(input: LoginInput): Promise<LoginResult> {
  try {
    const env = getAdminEnv()
    return performCredentialLogin(input, {
      appOrigin: env.NEXT_PUBLIC_APP_URL,
      credentialsEnabled:
        env.NODE_ENV !== 'production' &&
        env.AUTH_DEV_CREDENTIALS_ENABLED === 'true',
      signIn,
    })
  } catch {
    return { ok: false, code: 'AUTH_UNAVAILABLE', fieldErrors: {} }
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}
