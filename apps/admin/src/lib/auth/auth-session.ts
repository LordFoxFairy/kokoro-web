import { z } from 'zod'
import {
  isSessionExpired,
  sessionViewSchema,
  type SessionView,
} from './session'

const authSessionSchema = z
  .object({
    user: z
      .object({
        id: z.unknown(),
        name: z.string().nullable(),
        displayName: z.unknown(),
        email: z.unknown(),
        image: z.string().nullable(),
        capabilities: z.unknown(),
        scope: z.unknown().optional(),
      })
      .strict(),
    expires: z.unknown(),
  })
  .strict()

export function parseAuthSessionView(
  input: unknown,
  now: Date = new Date()
): SessionView | null {
  if (Number.isNaN(now.getTime())) return null

  const authSession = authSessionSchema.safeParse(input)
  if (!authSession.success) return null

  const sessionView = sessionViewSchema.safeParse({
    user: {
      id: authSession.data.user.id,
      displayName: authSession.data.user.displayName,
      email: authSession.data.user.email,
    },
    expiresAt: authSession.data.expires,
    capabilities: authSession.data.user.capabilities,
    scope: authSession.data.user.scope,
  })

  if (!sessionView.success || isSessionExpired(sessionView.data, now)) {
    return null
  }

  return sessionView.data
}
