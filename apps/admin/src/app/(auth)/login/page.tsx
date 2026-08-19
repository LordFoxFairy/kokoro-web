import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import {
  ArrowRight,
  CircleCheckBig,
  Fingerprint,
  MonitorPlay,
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

const heroHighlights = [
  {
    icon: Fingerprint,
    title: '统一身份与会话',
    description: 'Auth.js 会话统一托管，登录后安全回跳，跨页面状态一致。',
  },
  {
    icon: CircleCheckBig,
    title: '按契约闭环',
    description:
      '页面数据全部走已校验的数据载入路径，权限与站点边界由后端边界决定。',
  },
  {
    icon: MonitorPlay,
    title: '布局与交互统一',
    description: '沿用 shadcn-admin 的双栏布局节奏，减少跳动、过渡更平滑。',
  },
]

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

  const useCredentialLogin =
    env !== null &&
    env.NODE_ENV !== 'production' &&
    env.AUTH_DEV_CREDENTIALS_ENABLED === 'true'

  return (
    <main className='min-h-svh bg-background'>
      <div className='relative grid min-h-svh lg:grid-cols-[1.15fr_1fr]'>
        <aside className='relative hidden overflow-hidden border-e border-border/60 bg-muted max-lg:hidden'>
          <div className='absolute inset-0 bg-gradient-to-br from-sky-200/30 via-transparent to-fuchsia-200/30 dark:from-sky-950/45 dark:to-fuchsia-950/40' />
          <div className='relative h-full w-full'>
            <img
              src='/login/dashboard-light.png'
              alt='Kokoro Admin 背景（明）'
              className='absolute inset-0 h-full w-full object-cover object-top-left select-none dark:hidden'
            />
            <img
              src='/login/dashboard-dark.png'
              alt='Kokoro Admin 背景（暗）'
              className='absolute inset-0 hidden h-full w-full object-cover object-top-left select-none dark:block'
              loading='lazy'
            />
          </div>
          <div className='absolute inset-0 bg-gradient-to-r from-background/80 via-background/35 to-background/10' />
          <div className='relative z-10 flex h-full flex-col justify-between px-12 py-12'>
            <div>
              <p className='mb-2 inline-flex items-center rounded-full border border-white/40 bg-white/40 px-3 py-1 text-xs font-medium tracking-[0.2em] text-foreground/80 uppercase'>
                Kokoro Console
              </p>
              <h1 className='max-w-md text-4xl leading-tight font-semibold tracking-tight'>
                Enterprise IAM Control Plane
              </h1>
              <p className='mt-5 max-w-lg text-sm leading-7 text-muted-foreground'>
                在视觉结构上对齐 shadcn-admin 设计语言，保留官方 shadcn/ui +
                TanStack Table + RHF + Zod 的实现边界。
              </p>
            </div>
            <div className='mt-6 space-y-3'>
              {heroHighlights.map((item) => {
                const Icon = item.icon
                return (
                  <article
                    key={item.title}
                    className='rounded-xl border border-white/40 bg-background/50 px-4 py-3 backdrop-blur-sm'
                  >
                    <div className='flex items-center gap-2'>
                      <span className='inline-flex size-7 items-center justify-center rounded-lg bg-white/80 text-foreground/80'>
                        <Icon className='size-3.5' aria-hidden='true' />
                      </span>
                      <h2 className='text-sm font-medium'>{item.title}</h2>
                    </div>
                    <p className='mt-2 text-sm text-muted-foreground'>
                      {item.description}
                    </p>
                  </article>
                )
              })}
            </div>
          </div>
        </aside>

        <section className='grid min-h-svh place-items-center px-4 py-8 sm:px-8'>
          <div className='w-full max-w-sm'>
            <div className='mb-8 flex items-center justify-center gap-2 text-center lg:hidden'>
              <span className='inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
                <CircleCheckBig className='size-4' aria-hidden='true' />
              </span>
              <span className='text-lg font-semibold'>Kokoro 管理控制台</span>
            </div>
            <Card className='rounded-2xl border-border/60 shadow-sm'>
              <CardHeader className='space-y-2 pb-4'>
                <CardTitle className='text-2xl tracking-tight'>
                  管理员登录
                </CardTitle>
                <CardDescription>
                  Enter your account below to sign in to the console.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LoginForm
                  action={loginAction}
                  callbackUrl={callbackUrl}
                  credentialsEnabled={useCredentialLogin}
                />
              </CardContent>
            </Card>
            <div className='mt-4 space-y-2 text-end text-xs text-muted-foreground'>
              <p>
                由 Auth.js 提供身份边界与会话管理，前端仅消费版本化 API 契约。
              </p>
              <p className='inline-flex items-center gap-1'>
                <ArrowRight className='size-3.5' aria-hidden='true' />
                登录成功后自动返回 {callbackUrl}
              </p>
            </div>
          </div>
        </section>
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
