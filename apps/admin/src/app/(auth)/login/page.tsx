import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { CheckCircle2, Shield, ShieldCheck } from 'lucide-react'
import { loginAction } from '@/lib/auth/actions'
import { parseAuthSessionView } from '@/lib/auth/auth-session'
import { resolveSafeAdminCallbackUrl } from '@/lib/auth/redirect'
import { getAdminEnv } from '@/lib/server/env'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
    <main className='min-h-svh bg-background'>
      <div className='grid min-h-svh grid-cols-1 overflow-hidden lg:grid-cols-[1fr_470px]'>
        <section className='relative hidden overflow-hidden bg-slate-900 p-10 text-slate-50 lg:block'>
          <div className='absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950' />
          <div className='relative z-10 mt-1 flex items-center gap-3'>
            <span className='flex size-10 items-center justify-center rounded-xl bg-slate-700'>
              <ShieldCheck
                className='size-5 text-slate-100'
                aria-hidden='true'
              />
            </span>
            <span className='text-lg font-semibold'>Kokoro Console</span>
          </div>
          <div className='relative z-10 mt-16 max-w-lg space-y-6'>
            <h1 className='text-4xl leading-tight font-semibold tracking-tight text-white'>
              企业级管理控制台
            </h1>
            <p className='text-sm text-slate-200/90'>
              以官方 shadcn/ui 组件为基础，保持清晰信息层级、可达性和稳定布局。
            </p>
            <div className='space-y-4'>
              <p className='text-xs font-medium tracking-[0.25em] text-slate-300/80 uppercase'>
                关键能力
              </p>
              <ul className='space-y-3 text-sm text-slate-200/90'>
                <li className='flex items-start gap-2'>
                  <CheckCircle2 className='mt-0.5 size-4 text-white' />
                  <span>登录后安全回跳并维持会话一致。</span>
                </li>
                <li className='flex items-start gap-2'>
                  <CheckCircle2 className='mt-0.5 size-4 text-white' />
                  <span>版本化 API 契约驱动，接口稳定可追溯。</span>
                </li>
                <li className='flex items-start gap-2'>
                  <CheckCircle2 className='mt-0.5 size-4 text-white' />
                  <span>桌面与移动端统一呈现，避免视觉偏差。</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <div className='grid place-items-center px-4 py-8 sm:px-8'>
          <div className='w-full max-w-sm'>
            <div className='mb-6 flex items-center justify-center gap-2 lg:hidden'>
              <span className='flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
                <Shield aria-hidden='true' />
              </span>
              <span className='text-lg font-semibold'>Kokoro 管理控制台</span>
            </div>
            <Card className='rounded-xl border-border/70 shadow-sm'>
              <CardHeader className='space-y-2'>
                <CardTitle className='text-xl'>管理员登录</CardTitle>
                <CardDescription>
                  使用管理员账号访问控制台，登录成功后跳转到目标页面。
                </CardDescription>
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

            <p className='mt-4 text-xs text-muted-foreground sm:text-right'>
              组件采用官方 shadcn/ui 基元，结合 Next.js 与 Auth.js
            </p>
          </div>
        </div>
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
