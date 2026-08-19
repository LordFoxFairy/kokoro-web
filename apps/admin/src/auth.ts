import NextAuth from 'next-auth'
import { createAuthConfig } from '@/lib/auth/config'
import { getAdminEnv } from '@/lib/server/env'

export const { handlers, auth, signIn, signOut } = NextAuth(() =>
  createAuthConfig(getAdminEnv())
)
