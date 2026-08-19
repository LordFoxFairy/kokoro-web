'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  AtSign,
  CircleAlert,
  LogIn,
  ShieldCheck,
  ShieldQuestion,
  KeyRound,
} from 'lucide-react'
import {
  loginInputSchema,
  type LoginInput,
  type LoginResult,
} from '@/lib/auth/login'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

type LoginAction = (input: LoginInput) => Promise<LoginResult>

type LoginFormProps = {
  readonly callbackUrl: string
  readonly credentialsEnabled: boolean
  readonly action: LoginAction
}

const errorMessages = {
  AUTH_INVALID_CREDENTIALS: '账号或密码不正确',
  AUTH_UNAVAILABLE: '登录服务暂时不可用',
} as const

export function LoginForm({
  callbackUrl,
  credentialsEnabled,
  action,
}: LoginFormProps) {
  const router = useRouter()
  const [formError, setFormError] = useState<keyof typeof errorMessages | null>(
    null
  )
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { account: '', password: '', callbackUrl },
  })

  if (!credentialsEnabled) {
    return (
      <Alert>
        <ShieldQuestion aria-hidden='true' />
        <AlertTitle>登录方式未配置</AlertTitle>
        <AlertDescription>
          当前环境未配置可用的登录方式，请联系平台管理员。
        </AlertDescription>
      </Alert>
    )
  }

  const submit = form.handleSubmit(async (input) => {
    setFormError(null)
    const result = await action(input)
    if (result.ok) {
      router.replace(result.redirectTo)
      router.refresh()
      return
    }

    if (result.code === 'AUTH_INVALID_INPUT') {
      for (const field of ['account', 'password'] as const) {
        const message = result.fieldErrors[field]?.[0]
        if (message) form.setError(field, { message, type: 'server' })
      }
      return
    }

    setFormError(result.code)
  })

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup className='gap-4'>
        {formError && (
          <Alert variant='destructive'>
            <CircleAlert aria-hidden='true' />
            <AlertTitle>登录失败</AlertTitle>
            <AlertDescription>{errorMessages[formError]}</AlertDescription>
          </Alert>
        )}

        <Field data-invalid={Boolean(form.formState.errors.account)}>
          <FieldLabel htmlFor='account' className='text-sm'>
            账号
          </FieldLabel>
          <div className='relative'>
            <AtSign
              className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground'
              aria-hidden='true'
            />
            <Input
              id='account'
              autoComplete='username'
              aria-invalid={Boolean(form.formState.errors.account)}
              placeholder='请输入管理员账号'
              className='pl-9'
              disabled={form.formState.isSubmitting}
              {...form.register('account')}
            />
          </div>
          <FieldError errors={[form.formState.errors.account]} />
        </Field>

        <Field data-invalid={Boolean(form.formState.errors.password)}>
          <FieldLabel htmlFor='password' className='text-sm'>
            密码
          </FieldLabel>
          <div className='relative'>
            <KeyRound
              className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground'
              aria-hidden='true'
            />
            <Input
              id='password'
              type='password'
              autoComplete='current-password'
              aria-invalid={Boolean(form.formState.errors.password)}
              placeholder='请输入登录密码'
              className='pl-9'
              disabled={form.formState.isSubmitting}
              {...form.register('password')}
            />
          </div>
          <FieldError errors={[form.formState.errors.password]} />
        </Field>

        <input type='hidden' {...form.register('callbackUrl')} />

        <Button
          type='submit'
          className='h-10 w-full gap-2'
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <Spinner aria-hidden='true' />
          ) : (
            <LogIn className='size-4' aria-hidden='true' />
          )}
          登录
        </Button>
        <div className='mt-1 flex items-center justify-between text-xs text-muted-foreground'>
          <span className='inline-flex items-center gap-1.5'>
            <ShieldCheck className='size-3.5' aria-hidden='true' />
            支持安全回跳
          </span>
          <span>登录即同意《服务条款》</span>
        </div>
      </FieldGroup>
    </form>
  )
}
