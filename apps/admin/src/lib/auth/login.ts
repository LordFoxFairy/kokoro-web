import { z } from 'zod'
import { resolveSafeAdminCallbackUrl } from './redirect'

export const loginInputSchema = z
  .object({
    account: z.string().trim().min(1, '请输入账号'),
    password: z.string().min(1, '请输入密码'),
    callbackUrl: z.string().optional(),
  })
  .strict()

export type LoginInput = z.infer<typeof loginInputSchema>
export type LoginResult =
  | { readonly ok: true; readonly redirectTo: string }
  | {
      readonly ok: false
      readonly code:
        'AUTH_INVALID_INPUT' | 'AUTH_INVALID_CREDENTIALS' | 'AUTH_UNAVAILABLE'
      readonly fieldErrors: Readonly<Record<string, readonly string[]>>
    }

type LoginDependencies = {
  readonly appOrigin: string
  readonly credentialsEnabled: boolean
  readonly signIn: (
    provider: string,
    options: Record<string, unknown>
  ) => unknown
}

export async function performCredentialLogin(
  input: unknown,
  dependencies: LoginDependencies
): Promise<LoginResult> {
  const parsed = loginInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'AUTH_INVALID_INPUT',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  if (!dependencies.credentialsEnabled) {
    return { ok: false, code: 'AUTH_UNAVAILABLE', fieldErrors: {} }
  }

  const redirectTo = resolveSafeAdminCallbackUrl(
    parsed.data.callbackUrl,
    dependencies.appOrigin
  )

  try {
    await dependencies.signIn('kokoro-dev-credentials', {
      account: parsed.data.account,
      password: parsed.data.password,
      redirect: false,
      redirectTo,
    })
    return { ok: true, redirectTo }
  } catch (error) {
    return {
      ok: false,
      code:
        authErrorType(error) === 'CredentialsSignin'
          ? 'AUTH_INVALID_CREDENTIALS'
          : 'AUTH_UNAVAILABLE',
      fieldErrors: {},
    }
  }
}

function authErrorType(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('type' in error)) {
    return null
  }

  return typeof error.type === 'string' ? error.type : null
}
