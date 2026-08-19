import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { AdminEnv } from '../env'

const credentialsSchema = z
  .object({
    account: z.string().min(1),
    password: z.string().min(1),
  })
  .strict()

export type DevelopmentAuthUser = {
  readonly id: string
  readonly name: string
  readonly displayName: string
  readonly email: string
  readonly capabilities: readonly string[]
}

type EnabledDevelopmentAuthEnv = AdminEnv & {
  readonly AUTH_DEV_CREDENTIALS_ENABLED: 'true'
  readonly AUTH_DEV_ACCOUNT: string
  readonly AUTH_DEV_PASSWORD: string
  readonly AUTH_DEV_USER_ID: string
  readonly AUTH_DEV_DISPLAY_NAME: string
  readonly AUTH_DEV_EMAIL: string
  readonly AUTH_DEV_CAPABILITIES: string
}

export function authorizeDevelopmentCredentials(
  credentials: unknown,
  env: AdminEnv
): DevelopmentAuthUser | null {
  if (!isEnabledDevelopmentAuthEnv(env)) return null

  const parsed = credentialsSchema.safeParse(pickCredentialValues(credentials))
  if (!parsed.success) return null

  if (
    !matchesSecret(parsed.data.account, env.AUTH_DEV_ACCOUNT) ||
    !matchesSecret(parsed.data.password, env.AUTH_DEV_PASSWORD)
  ) {
    return null
  }

  return {
    id: env.AUTH_DEV_USER_ID,
    name: env.AUTH_DEV_DISPLAY_NAME,
    displayName: env.AUTH_DEV_DISPLAY_NAME,
    email: env.AUTH_DEV_EMAIL,
    capabilities: [
      ...new Set(
        env.AUTH_DEV_CAPABILITIES.split(',')
          .map((capability) => capability.trim())
          .filter(Boolean)
      ),
    ],
  }
}

function pickCredentialValues(input: unknown): {
  account?: unknown
  password?: unknown
} {
  if (typeof input !== 'object' || input === null) return {}

  const values = input as Record<string, unknown>
  return { account: values.account, password: values.password }
}

function isEnabledDevelopmentAuthEnv(
  env: AdminEnv
): env is EnabledDevelopmentAuthEnv {
  return (
    env.NODE_ENV !== 'production' &&
    env.AUTH_DEV_CREDENTIALS_ENABLED === 'true' &&
    env.AUTH_DEV_ACCOUNT !== undefined &&
    env.AUTH_DEV_PASSWORD !== undefined &&
    env.AUTH_DEV_USER_ID !== undefined &&
    env.AUTH_DEV_DISPLAY_NAME !== undefined &&
    env.AUTH_DEV_EMAIL !== undefined &&
    env.AUTH_DEV_CAPABILITIES !== undefined
  )
}

function matchesSecret(actual: string, expected: string): boolean {
  const digest = (value: string) =>
    createHash('sha256').update(value, 'utf8').digest()

  return timingSafeEqual(digest(actual), digest(expected))
}
