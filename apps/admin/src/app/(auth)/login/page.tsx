import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { CheckCircle2, Shield, ShieldCheck, Sparkles } from 'lucide-react'
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
      <div className='relative grid min-h-svh grid-cols-1 overflow-hidden lg:grid-cols-[1.2fr_1fr]'>
        <section className='relative hidden bg-gradient-to-br from-primary/10 via-background to-background p-12 text-foreground lg:block'>
          <div
            aria-hidden='true'
            className='pointer-events-none absolute inset-0'
          >
            <div className='absolute top-[-15%] right-[-20%] size-72 rounded-full bg-primary/15 blur-3xl' />
            <div className='absolute bottom-[-10%] left-[-18%] size-64 rounded-full bg-primary/20 blur-3xl' />
            <div className='absolute inset-10 rounded-3xl border border-white/40 bg-background/60 backdrop-blur' />
          </div>

          <div className='relative flex h-full flex-col justify-between'>
            <div className='mb-8 flex items-center gap-3'>
              <span className='flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow'>
                <ShieldCheck className='size-6' aria-hidden='true' />
              </span>
              <span className='text-2xl font-semibold tracking-tight'>
                Kokoro 管理控制台
              </span>
            </div>

            <div className='relative space-y-6 text-sm'>
              <p className='max-w-md leading-6 text-muted-foreground'>
                统一入口、统一治理，面向 Admin 的登录界面对齐 shadcn
                视觉语法，强调低跳动、清晰信息层级与可达性。
              </p>

              <ul className='space-y-4'>
                <li className='flex items-start gap-2'>
                  <CheckCircle2 className='mt-0.5 size-4 text-primary' />
                  <span>登录后访问用户、组织、Site 与权限管理入口。</span>
                </li>
                <li className='flex items-start gap-2'>
                  <CheckCircle2 className='mt-0.5 size-4 text-primary' />
                  <span>Session 与回跳由 Auth.js 与安全路由层统一处理。</span>
                </li>
                <li className='flex items-start gap-2'>
                  <CheckCircle2 className='mt-0.5 size-4 text-primary' />
                  <span>
                    仅展示已授权操作路径与页面，避免跨 Site 的无效入口。
                  </span>
                </li>
              </ul>
            </div>

            <div className='mt-8'>
              <p className='text-xs font-medium text-muted-foreground'>
                目标体验
              </p>
              <p className='mt-2 max-w-sm text-sm text-muted-foreground'>
                控制台以一致的桌面/移动端信息架构承载完整 Admin
                工作流，确保布局稳定、不闪烁、不跳动。
              </p>
            </div>
          </div>
        </section>

        <div className='grid place-items-center px-4 py-6 sm:px-6'>
          <div className='w-full max-w-sm'>
            <div className='mb-8 flex items-center justify-center gap-2 lg:hidden'>
              <span className='flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
                <Shield aria-hidden='true' />
              </span>
              <span className='text-lg font-semibold'>Kokoro 管理控制台</span>
            </div>
            <Card className='rounded-2xl border-border/60 shadow-sm'>
              <CardHeader className='space-y-2 pb-4'>
                <CardTitle className='text-2xl'>管理员登录</CardTitle>
                <CardDescription>
                  使用管理员账号继续访问控制台，登录成功后将安全回跳到目标页面。
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-1'>
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

            <p className='mt-4 flex items-center gap-1.5 text-xs text-muted-foreground sm:justify-end'>
              <Sparkles className='size-3.5' />
              组件采用官方 shadcn/ui 基元，保留 Next.js 与 Auth.js 主链路
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
