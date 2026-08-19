import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Shield } from 'lucide-react'
import { loginAction } from '@/lib/auth/actions'
import { parseAuthSessionView } from '@/lib/auth/auth-session'
import { resolveSafeAdminCallbackUrl } from '@/lib/auth/redirect'
import { getAdminEnv } from '@/lib/server/env'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from '@/components/auth/login-form'

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const env = readAdminEnv()

  const params = await searchParams
  const requestedCallback = params.callbackUrl
  const callbackCandidate = Array.isArray(requestedCallback)
    ? requestedCallback[0]
    : requestedCallback
  const appOrigin = env?.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3100'
  const callbackUrl = resolveSafeAdminCallbackUrl(callbackCandidate, appOrigin)

  const currentSession = await readAuthSession()

  if (parseAuthSessionView(currentSession) !== null) {
    redirect(callbackUrl)
  }

  return (
    <main className='grid min-h-svh place-items-center bg-muted/40 p-4'>
      <div className='w-full max-w-sm'>
        <div className='mb-6 flex items-center justify-center gap-2'>
          <span className='flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
            <Shield aria-hidden='true' />
          </span>
          <span className='text-lg font-semibold'>Kokoro 管理控制台</span>
        </div>
        <Card className='rounded-lg shadow-sm'>
          <CardHeader>
            <CardTitle className='text-lg'>登录</CardTitle>
          </CardHeader>
          <CardContent>
            <LoginForm
              action={loginAction}
              callbackUrl={callbackUrl}
              credentialsEnabled={
                env !== null &&
                env.NODE_ENV !== 'production' &&
                env.AUTH_DEV_CREDENTIALS_ENABLED === 'true'
              }
            />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function readAdminEnv(): Awaited<ReturnType<typeof getAdminEnv>> | null {
  try {
    return getAdminEnv()
  } catch {
    return null
  }
}

async function readAuthSession() {
  try {
    return await auth()
  } catch {
    return null
  }
}
