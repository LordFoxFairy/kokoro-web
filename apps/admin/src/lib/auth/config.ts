import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import type { AdminEnv } from '../env'
import { parseAuthSessionView } from './auth-session'
import {
  authorizeDevelopmentCredentials,
  type DevelopmentAuthUser,
} from './development-credentials'
import { resolveSafeAdminCallbackUrl } from './redirect'
import { sessionViewSchema } from './session'

const sessionIdentitySchema = sessionViewSchema.omit({ expiresAt: true })
const authClaimSourceSchema = z
  .object({
    id: z.string().optional(),
    sub: z.string().optional(),
    name: z.string().nullable().optional(),
    displayName: z.unknown(),
    email: z.unknown(),
    capabilities: z.unknown(),
    scope: z.unknown().optional(),
  })
  .passthrough()

type SessionIdentity = z.infer<typeof sessionIdentitySchema>

function identityFromClaims(input: unknown): SessionIdentity | null {
  const source = authClaimSourceSchema.safeParse(input)
  if (!source.success) return null

  const identity = sessionIdentitySchema.safeParse({
    user: {
      id: source.data.id ?? source.data.sub,
      displayName: source.data.displayName,
      email: source.data.email,
    },
    capabilities: source.data.capabilities,
    scope: source.data.scope,
  })

  return identity.success ? identity.data : null
}

function tokenFromIdentity(identity: SessionIdentity) {
  return {
    sub: identity.user.id,
    name: identity.user.displayName,
    email: identity.user.email,
    displayName: identity.user.displayName,
    capabilities: identity.capabilities,
    ...(identity.scope === undefined ? {} : { scope: identity.scope }),
  }
}

export function createAuthConfig(env: AdminEnv): NextAuthConfig {
  const providers =
    env.NODE_ENV !== 'production' && env.AUTH_DEV_CREDENTIALS_ENABLED === 'true'
      ? [
          Credentials({
            id: 'kokoro-dev-credentials',
            name: 'Kokoro development credentials',
            credentials: {
              account: { label: '账号', type: 'text' },
              password: { label: '密码', type: 'password' },
            },
            async authorize(credentials) {
              return authorizeDevelopmentCredentials(
                credentials,
                env
              ) as DevelopmentAuthUser | null
            },
          }),
        ]
      : []

  return {
    secret: env.AUTH_SECRET,
    providers,
    pages: { signIn: '/login' },
    session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
    callbacks: {
      async jwt({ token, user }) {
        const identity = identityFromClaims(user ?? token)
        return identity === null ? {} : tokenFromIdentity(identity)
      },
      async session({ session, token }) {
        const identity = identityFromClaims(token)
        if (identity === null) return session

        return {
          expires: session.expires,
          user: {
            id: identity.user.id,
            name: identity.user.displayName,
            displayName: identity.user.displayName,
            email: identity.user.email,
            image: null,
            capabilities: identity.capabilities,
            ...(identity.scope === undefined ? {} : { scope: identity.scope }),
          },
        }
      },
      authorized({ request, auth }) {
        const pathname = request.nextUrl.pathname
        if (pathname === '/login' || pathname.startsWith('/api/auth/')) {
          return true
        }
        if (parseAuthSessionView(auth) !== null) return true

        const requestedPath = `${pathname}${request.nextUrl.search}`
        const loginUrl = new URL('/login', env.NEXT_PUBLIC_APP_URL)
        loginUrl.searchParams.set(
          'callbackUrl',
          resolveSafeAdminCallbackUrl(requestedPath, env.NEXT_PUBLIC_APP_URL)
        )
        return NextResponse.redirect(loginUrl)
      },
      redirect({ url }) {
        const path = resolveSafeAdminCallbackUrl(url, env.NEXT_PUBLIC_APP_URL)
        return new URL(path, env.NEXT_PUBLIC_APP_URL).toString()
      },
    },
  }
}
