import { z } from 'zod'

const httpUrl = z
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Must use the http or https protocol',
  })

const httpOrigin = httpUrl.refine(
  (value) => {
    const url = new URL(value)
    return (
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    )
  },
  { message: 'Must be an HTTP(S) origin without credentials, path or query' }
)

const productionSecretPlaceholder = 'replace-with-at-least-32-characters'
const developmentCredentialKeys = [
  'AUTH_DEV_ACCOUNT',
  'AUTH_DEV_PASSWORD',
  'AUTH_DEV_USER_ID',
  'AUTH_DEV_DISPLAY_NAME',
  'AUTH_DEV_EMAIL',
  'AUTH_DEV_CAPABILITIES',
] as const

function isSafeAuthSecret(secret: string | undefined): secret is string {
  return (
    secret !== undefined &&
    secret.trim().length >= 32 &&
    secret !== productionSecretPlaceholder
  )
}

const adminEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    NEXT_PUBLIC_APP_URL: httpOrigin,
    ADMIN_DATA_SOURCE: z.enum(['fixture', 'rpc']),
    AUTH_SECRET: z.string().optional(),
    IAM_RPC_URL: httpUrl.optional(),
    AUTH_DEV_CREDENTIALS_ENABLED: z.enum(['true', 'false']).optional(),
    AUTH_DEV_ACCOUNT: z.string().trim().min(1).optional(),
    AUTH_DEV_PASSWORD: z.string().min(1).optional(),
    AUTH_DEV_USER_ID: z.string().trim().min(1).optional(),
    AUTH_DEV_DISPLAY_NAME: z.string().trim().min(1).optional(),
    AUTH_DEV_EMAIL: z.email().optional(),
    AUTH_DEV_CAPABILITIES: z.string().trim().min(1).optional(),
  })
  // Callers may pass process.env; only this explicit allowlist survives parsing.
  .strip()
  .superRefine((env, context) => {
    const configuredDevelopmentCredentials = developmentCredentialKeys.filter(
      (key) => env[key] !== undefined
    )

    if (
      env.NODE_ENV === 'production' &&
      (env.AUTH_DEV_CREDENTIALS_ENABLED !== undefined ||
        configuredDevelopmentCredentials.length > 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Development credentials are forbidden in production',
        path: ['AUTH_DEV_CREDENTIALS_ENABLED'],
      })
    } else if (env.AUTH_DEV_CREDENTIALS_ENABLED === 'true') {
      if (
        configuredDevelopmentCredentials.length !==
        developmentCredentialKeys.length
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Development credentials require all AUTH_DEV fields',
          path: ['AUTH_DEV_CREDENTIALS_ENABLED'],
        })
      }

      if (!isSafeAuthSecret(env.AUTH_SECRET)) {
        context.addIssue({
          code: 'custom',
          message:
            'AUTH_SECRET is required when development credentials are enabled',
          path: ['AUTH_SECRET'],
        })
      }
    } else if (configuredDevelopmentCredentials.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Development credentials must be explicitly enabled',
        path: ['AUTH_DEV_CREDENTIALS_ENABLED'],
      })
    }

    if (env.ADMIN_DATA_SOURCE === 'rpc' && env.IAM_RPC_URL === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'IAM_RPC_URL is required when ADMIN_DATA_SOURCE is rpc',
        path: ['IAM_RPC_URL'],
      })
    }

    if (env.NODE_ENV !== 'production') return

    if (env.ADMIN_DATA_SOURCE !== 'rpc') {
      context.addIssue({
        code: 'custom',
        message: 'ADMIN_DATA_SOURCE must be rpc in production',
        path: ['ADMIN_DATA_SOURCE'],
      })
    }

    if (!isSafeAuthSecret(env.AUTH_SECRET)) {
      context.addIssue({
        code: 'custom',
        message:
          'AUTH_SECRET must contain at least 32 characters in production',
        path: ['AUTH_SECRET'],
      })
    }
  })

export type AdminEnvInput = Readonly<Record<string, string | undefined>>
const ADMIN_ENV_BRAND = Symbol('kokoro.admin.parsed-env')

export type AdminEnv = z.infer<typeof adminEnvSchema> &
  Readonly<{ [ADMIN_ENV_BRAND]: true }>
export type PublicAdminEnv = Readonly<{ appUrl: string }>

/** Parses an explicit environment input without consulting ambient process state. */
export function parseAdminEnv(input: AdminEnvInput): AdminEnv {
  const parsed = adminEnvSchema.parse(input)
  Object.defineProperty(parsed, ADMIN_ENV_BRAND, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  })
  return Object.freeze(parsed) as AdminEnv
}

export function isParsedAdminEnv(value: unknown): value is AdminEnv {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getOwnPropertyDescriptor(value, ADMIN_ENV_BRAND)?.value === true
  )
}

/** Projects the sole browser-safe setting; server endpoints and secrets stay private. */
export function pickPublicAdminEnv(env: AdminEnv): PublicAdminEnv {
  return { appUrl: env.NEXT_PUBLIC_APP_URL }
}
