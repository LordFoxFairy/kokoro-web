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

const adminEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    NEXT_PUBLIC_APP_URL: httpOrigin,
    ADMIN_DATA_SOURCE: z.enum(['fixture', 'rpc']),
    AUTH_SECRET: z.string().optional(),
    IAM_RPC_URL: httpUrl.optional(),
  })
  // Callers may pass process.env; only this explicit allowlist survives parsing.
  .strip()
  .superRefine((env, context) => {
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

    if (
      env.AUTH_SECRET === undefined ||
      env.AUTH_SECRET.trim().length < 32 ||
      env.AUTH_SECRET === productionSecretPlaceholder
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'AUTH_SECRET must contain at least 32 characters in production',
        path: ['AUTH_SECRET'],
      })
    }
  })

export type AdminEnvInput = Readonly<Record<string, string | undefined>>
export type AdminEnv = z.infer<typeof adminEnvSchema>
export type PublicAdminEnv = Readonly<{ appUrl: string }>

/** Parses an explicit environment input without consulting ambient process state. */
export function parseAdminEnv(input: AdminEnvInput): AdminEnv {
  return adminEnvSchema.parse(input)
}

/** Projects the sole browser-safe setting; server endpoints and secrets stay private. */
export function pickPublicAdminEnv(env: AdminEnv): PublicAdminEnv {
  return { appUrl: env.NEXT_PUBLIC_APP_URL }
}
