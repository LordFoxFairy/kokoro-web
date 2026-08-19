import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import {
  ArrowRight,
  CircleCheckBig,
  Fingerprint,
  MonitorPlay,
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

const highlights = [
  {
    icon: Fingerprint,
    title: '统一身份与会话',
    description: 'Auth.js 会话统一托管，登录后安全回跳，跨页状态一致。',
  },
  {
    icon: ShieldCheck,
    title: '按契约协作',
    description: '页面数据只读契约输入，权限、租户和 Site 完全由后端边界决定。',
  },
  {
    icon: CircleCheckBig,
    title: '稳定交互',
    description: '桌面与移动端采用统一布局栈，减少闪动与跳动。',
  },
  {
    icon: MonitorPlay,
    title: '视觉基线一致',
    description: '借鉴 shadcn-admin 的双栏登录视觉结构，统一间距与视觉层级。',
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

  return (
    <main className='min-h-svh bg-background text-foreground'>
      <div className='relative grid min-h-svh lg:grid-cols-[1fr_540px]'>
        <aside className='relative hidden overflow-hidden bg-muted max-lg:hidden'>
          <div className='absolute inset-0 bg-[radial-gradient(140%_130%_at_10%_20%,theme(colors.slate.300)_0%,theme(colors.background)_48%,transparent_55%),radial-gradient(90%_80%_at_100%_100%,theme(colors.indigo.200)_0%,theme(colors.background)_45%)]' />
          <div className='pointer-events-none absolute inset-y-10 -left-20 h-72 w-72 rounded-full bg-cyan-300/25 blur-[110px]' />
          <div className='pointer-events-none absolute inset-y-2 -right-16 h-80 w-80 rounded-full bg-fuchsia-300/25 blur-[130px]' />
          <div className='relative z-10 mx-auto flex h-full w-full max-w-2xl flex-col justify-between px-12 py-16'>
            <div>
              <div className='mb-10 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/60 px-3 py-1 text-xs font-medium text-zinc-700 backdrop-blur'>
                <Shield className='size-3.5 text-primary' aria-hidden='true' />
                Admin Login
              </div>
              <p className='text-xs uppercase tracking-[0.24em] text-zinc-600/90'>
                Kokoro Console
              </p>
              <h1 className='mt-4 text-4xl leading-tight font-semibold tracking-tight text-zinc-900'>
                Enterprise IAM Control Plane
              </h1>
              <p className='mt-5 max-w-xl text-sm leading-7 text-zinc-700'>
                对齐 shadcn-admin 的双栏页面节奏与视觉层级，使用
                shadcn/ui、RHF、Zod 与 Auth.js，保证桌面与移动端的稳定交互。
              </p>
            </div>
            <div className='mt-10 space-y-3'>
              {highlights.map((item) => {
                const Icon = item.icon
                return (
                  <article
                    key={item.title}
                    className='rounded-xl border border-zinc-200/70 bg-white/75 p-4 backdrop-blur'
                  >
                    <div className='mb-1 flex items-center gap-2'>
                      <Icon
                        className='size-4 text-primary'
                        aria-hidden='true'
                      />
                      <p className='text-sm font-medium'>{item.title}</p>
                    </div>
                    <p className='text-sm text-zinc-600'>{item.description}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </aside>

        <section className='relative grid min-h-svh place-items-center px-4 py-8 sm:px-8'>
          <div className='w-full max-w-sm'>
            <div className='mb-8 flex items-center justify-center gap-2 lg:hidden'>
              <span className='flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
                <Shield aria-hidden='true' />
              </span>
              <span className='text-lg font-semibold'>Kokoro 管理控制台</span>
            </div>
            <Card className='rounded-2xl border-border/70 shadow-lg shadow-black/10'>
              <CardHeader className='space-y-2 pb-4'>
                <CardTitle className='text-2xl tracking-tight'>
                  管理员登录
                </CardTitle>
                <CardDescription>
                  Enter your admin account below to sign in to the console.
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

            <p className='mt-4 text-xs text-muted-foreground'>
              由 Auth.js 提供身份边界与会话管理，前端仅消费版本化 API 契约。
            </p>
            <p className='mt-2 flex items-center justify-end gap-1 text-xs text-muted-foreground'>
              <ArrowRight className='size-3.5' aria-hidden='true' />
              继续进入 /users 页面
            </p>
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
