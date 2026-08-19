import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import {
  ArrowRight,
  CircleCheckBig,
  Fingerprint,
  MonitorPlay,
  Shield,
  UserRound,
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
    description: 'Auth.js 承载登录态，登录成功后安全回跳，跨页面状态一致。',
  },
  {
    icon: CircleCheckBig,
    title: '按契约闭环',
    description:
      '所有业务界面仅消费版本化 API 契约，权限与站点边界由后端契约决定。',
  },
  {
    icon: MonitorPlay,
    title: '布局一致性',
    description:
      '借鉴 shadcn-admin 的节奏，统一字体、间距和间断，不再出现视觉抖动。',
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
    <main className='min-h-svh bg-background text-foreground'>
      <div className='grid min-h-svh lg:grid-cols-[1.12fr,1fr]'>
        <aside className='relative hidden overflow-hidden border-r border-border/60 bg-muted lg:block'>
          <img
            src='/login/dashboard-dark.png'
            alt='Kokoro Admin 仪表盘（暗）'
            className='absolute inset-0 h-full w-full object-cover object-top-left select-none dark:block'
          />
          <img
            src='/login/dashboard-light.png'
            alt='Kokoro Admin 仪表盘（亮）'
            className='absolute inset-0 h-full w-full object-cover object-top-left select-none dark:hidden'
          />

          <div className='absolute inset-0 bg-gradient-to-r from-background via-background/45 to-background/20' />

          <div className='relative z-10 flex h-full flex-col justify-between px-10 py-10 xl:px-12'>
            <div>
              <p className='mb-6 inline-flex items-center gap-2 rounded-full border border-white/45 bg-white/30 px-3 py-1 text-[11px] font-medium tracking-[0.2em] text-foreground/80 backdrop-blur'>
                <Shield className='size-3.5' aria-hidden='true' />
                KOKORO ADMIN
              </p>

              <h1 className='max-w-xl text-4xl leading-tight font-semibold tracking-tight'>
                Enterprise IAM Control Plane
              </h1>
              <p className='mt-5 max-w-sm text-sm leading-7 text-muted-foreground'>
                官方 shadcn
                风格的管理端登录页：统一交互语义、稳定布局、清晰层级。
                仅在授权与契约边界内完成会话、用户和站点隔离。
              </p>
            </div>

            <div className='mt-10 grid gap-3'>
              {heroHighlights.map((item) => {
                const Icon = item.icon
                return (
                  <article
                    key={item.title}
                    className='rounded-xl border border-white/35 bg-background/65 px-4 py-3 backdrop-blur'
                  >
                    <div className='flex items-center gap-2'>
                      <span className='inline-flex size-7 items-center justify-center rounded-lg bg-white/85 text-foreground/80'>
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

        <section className='flex min-h-svh items-center justify-center px-4 py-8 sm:px-8'>
          <div className='w-full max-w-md'>
            <div className='mb-6 flex items-center justify-center gap-2 text-center text-lg font-semibold lg:justify-start'>
              <span className='inline-flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground'>
                <UserRound className='size-5' aria-hidden='true' />
              </span>
              <span>管理员后台</span>
            </div>

            <Card className='relative overflow-hidden rounded-2xl border-border/80 shadow-lg'>
              <CardHeader className='space-y-1'>
                <CardTitle className='text-2xl tracking-tight'>登录</CardTitle>
                <CardDescription>
                  Sign in to continue to Kokoro Admin. Demo 环境支持开发凭据。
                </CardDescription>
              </CardHeader>

              <CardContent>
                <LoginForm
                  action={loginAction}
                  callbackUrl={callbackUrl}
                  credentialsEnabled={useCredentialLogin}
                />

                <div className='mt-5 flex items-center justify-between border-t border-border/60 pt-4 text-xs text-muted-foreground'>
                  <span className='inline-flex items-center gap-1.5'>
                    <ArrowRight className='size-3.5' aria-hidden='true' />
                    登录后返回 {callbackUrl}
                  </span>
                  <span>由 Auth.js 控制会话与回跳</span>
                </div>
              </CardContent>
            </Card>
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
