import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { logoutAction } from '@/lib/auth/actions'
import { parseAuthSessionView } from '@/lib/auth/auth-session'
import { AppShell } from '@/components/layout/app-shell'

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await readSession()

  if (session === null) redirect('/login')

  return (
    <AppShell session={session} onSignOut={logoutAction}>
      {children}
    </AppShell>
  )
}

async function readSession() {
  try {
    return parseAuthSessionView(await auth())
  } catch {
    return null
  }
}
