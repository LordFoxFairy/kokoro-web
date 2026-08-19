import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import {
  ArrowRight,
  Building2,
  CircleCheckBig,
  Shield,
  ShieldCheck,
  ShieldPlus,
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
    icon: ShieldPlus,
    title: '安全会话',
    description: 'Auth.js 会话统一托管，登录后安全回跳，跨页状态一致。',
  },
  {
    icon: Building2,
    title: '按契约协作',
    description: '页面数据只读契约输入，权限、租户和 Site 完全由后端边界决定。',
  },
  {
    icon: CircleCheckBig,
    title: '稳定交互',
    description: '桌面与移动端采用统一布局栈，减少闪动与跳动。',
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
      <div className='grid min-h-svh grid-cols-1 overflow-hidden lg:grid-cols-[1fr_520px]'>
        <section className='relative hidden overflow-hidden bg-zinc-950/95 text-zinc-50 shadow-2xl lg:block'>
          <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.22),_transparent_55%),radial-gradient(ellipse_at_20%_70%,_rgba(56,189,248,0.18),_transparent_45%),linear-gradient(140deg,_#0f172a_0%,_#0b1329_35%,_#020617_100%)]' />
          <div className='pointer-events-none absolute top-16 -left-24 h-96 w-96 rounded-full bg-cyan-400/30 blur-[140px]' />
          <div className='pointer-events-none absolute top-1/3 right-12 h-64 w-64 rounded-full bg-indigo-500/20 blur-[120px]' />

          <div className='relative z-10 mx-auto flex h-full max-w-2xl flex-col justify-between p-12'>
            <div>
              <div className='mb-12 flex items-center gap-3'>
                <span className='inline-flex size-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25'>
                  <Shield className='size-5' aria-hidden='true' />
                </span>
                <div>
                  <p className='text-xs tracking-[0.28em] text-zinc-200/80 uppercase'>
                    Kokoro Admin
                  </p>
                  <p className='text-sm font-medium'>管理控制台</p>
                </div>
              </div>

              <p className='text-xs tracking-[0.22em] text-zinc-400/90 uppercase'>
                Welcome to Console
              </p>
              <h1 className='mt-4 max-w-xl text-4xl leading-tight font-semibold tracking-tight text-white md:text-5xl'>
                Enterprise-grade IAM Control Plane UI
              </h1>
              <p className='mt-6 max-w-lg text-sm leading-7 text-zinc-200/90'>
                以官方 shadcn/ui
                组件标准构建，遵循统一的可访问性与视觉节奏。登录后进入 Admin
                端，完成会话、组织与权限等业务闭环。
              </p>
            </div>

            <div className='mt-12 space-y-4'>
              {highlights.map((item) => {
                const Icon = item.icon
                return (
                  <article
                    key={item.title}
                    className='rounded-xl border border-white/15 bg-white/5 p-4 backdrop-blur'
                  >
                    <div className='mb-2 flex items-center gap-2'>
                      <Icon
                        className='size-4 text-cyan-200'
                        aria-hidden='true'
                      />
                      <p className='text-sm font-medium'>{item.title}</p>
                    </div>
                    <p className='text-sm text-zinc-300'>{item.description}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <div className='grid place-items-center px-4 py-8 sm:px-8'>
          <div className='w-full max-w-sm'>
            <div className='mb-8 hidden items-center justify-end text-sm text-muted-foreground lg:flex'>
              <span className='inline-flex items-center gap-2'>
                <ShieldCheck
                  className='size-4 text-primary'
                  aria-hidden='true'
                />
                Admin 登录门禁已启用
              </span>
            </div>

            <div className='mb-6 flex items-center justify-center gap-2 lg:hidden'>
              <span className='flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
                <Shield aria-hidden='true' />
              </span>
              <span className='text-lg font-semibold'>Kokoro 管理控制台</span>
            </div>

            <Card className='rounded-2xl border-border/70 shadow-2xl shadow-black/8'>
              <CardHeader className='space-y-3 pb-4'>
                <CardTitle className='text-2xl tracking-tight'>
                  管理员登录
                </CardTitle>
                <CardDescription>
                  使用管理员账号登录，系统将保持会话连续性并执行安全回跳。
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

            <p className='mt-5 text-xs text-muted-foreground'>
              由 Auth.js 提供身份边界与会话管理，前端仅消费版本化 API 契约。
            </p>
            <p className='mt-2 flex items-center justify-end gap-1 text-xs text-muted-foreground'>
              <ArrowRight className='size-3.5' aria-hidden='true' />
              继续进入 /users 页面
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
