import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import {
  Building2,
  CheckCircle2,
  Sparkles,
  Shield,
  ShieldCheck,
} from 'lucide-react'
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
    <main className='relative grid min-h-svh overflow-hidden bg-muted/30 p-4 sm:p-6'>
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_var(--muted)_0%,_transparent_55%)]'
      />
      <div className='mx-auto flex w-full max-w-6xl items-stretch gap-6 lg:items-center'>
        <section className='hidden flex-1 lg:block'>
          <Card className='h-full rounded-2xl border-border/60 bg-card/85'>
            <CardHeader className='gap-3 pb-5'>
              <div className='flex items-center gap-2'>
                <span className='flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary'>
                  <ShieldCheck className='size-6' aria-hidden='true' />
                </span>
                <div>
                  <CardTitle className='text-xl'>Kokoro 控制台</CardTitle>
                  <CardDescription>
                    面向组织与业务域的统一管理入口
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className='space-y-6'>
              <p className='text-sm text-muted-foreground'>
                参考 shadcn
                风格体系，登录页聚焦关键任务入口，减少干扰元素，优先保证可读性和键盘可访问性。
              </p>
              <ul className='space-y-3 text-sm text-muted-foreground'>
                <li className='flex items-start gap-2'>
                  <CheckCircle2 className='mt-0.5 size-4 text-primary' />
                  <span>身份与会话由 Auth.js 统一治理。</span>
                </li>
                <li className='flex items-start gap-2'>
                  <CheckCircle2 className='mt-0.5 size-4 text-primary' />
                  <span>所有管理行为以版本化 API 契约驱动。</span>
                </li>
                <li className='flex items-start gap-2'>
                  <CheckCircle2 className='mt-0.5 size-4 text-primary' />
                  <span>数据面遵循 Site 与权限边界的最小授权原则。</span>
                </li>
              </ul>

              <div className='rounded-xl border border-border/80 bg-muted/50 p-4'>
                <div className='mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                  <Building2 className='size-4' />
                  上手提示
                </div>
                <p className='text-sm text-muted-foreground'>
                  登录后可进入组织、用户、站点、角色、权限树、会话和审计各类管理工作流，支持移动端与桌面端一致体验。
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <div className='mx-auto flex w-full max-w-sm flex-col justify-center'>
          <div className='mb-6 hidden items-center gap-2 lg:flex'>
            <span className='flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              <Shield aria-hidden='true' />
            </span>
            <span className='text-lg font-semibold'>Kokoro 管理控制台</span>
          </div>
          <Card className='rounded-xl border-border/60 bg-card/95 shadow-sm'>
            <CardHeader className='space-y-2'>
              <CardTitle className='text-xl'>管理员登录</CardTitle>
              <CardDescription>
                请使用管理员账号继续访问控制台，登录会在成功后返回您指定页面。
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

          <p className='mt-4 flex items-center gap-1.5 text-xs text-muted-foreground sm:justify-end'>
            <Sparkles className='size-3.5' />
            页面采用 shadcn/ui 与 Lucide 标准组件风格
          </p>
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
