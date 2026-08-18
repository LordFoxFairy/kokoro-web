import { z } from 'zod'

const sessionUserSchema = z
  .object({
    id: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    email: z.email(),
  })
  .strict()

const sessionScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('platform') }).strict(),
  z
    .object({ type: z.literal('organization'), id: z.string().trim().min(1) })
    .strict(),
  z.object({ type: z.literal('site'), id: z.string().trim().min(1) }).strict(),
])

export const sessionViewSchema = z
  .object({
    user: sessionUserSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    capabilities: z
      .array(z.string().trim().min(1))
      .transform((capabilities) => [...new Set(capabilities)]),
    scope: sessionScopeSchema.optional(),
  })
  .strict()

export type SessionView = z.infer<typeof sessionViewSchema>

export function parseSessionView(input: unknown): SessionView {
  return sessionViewSchema.parse(input)
}

export function isSessionExpired(
  session: Pick<SessionView, 'expiresAt'>,
  now: Date = new Date()
): boolean {
  return Date.parse(session.expiresAt) <= now.getTime()
}
