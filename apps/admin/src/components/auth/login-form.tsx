'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CircleAlert, ShieldAlert } from 'lucide-react'
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
        <ShieldAlert aria-hidden='true' />
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
          <FieldLabel htmlFor='account'>账号</FieldLabel>
          <Input
            id='account'
            autoComplete='username'
            aria-invalid={Boolean(form.formState.errors.account)}
            disabled={form.formState.isSubmitting}
            {...form.register('account')}
          />
          <FieldError errors={[form.formState.errors.account]} />
        </Field>
        <Field data-invalid={Boolean(form.formState.errors.password)}>
          <FieldLabel htmlFor='password'>密码</FieldLabel>
          <Input
            id='password'
            type='password'
            autoComplete='current-password'
            aria-invalid={Boolean(form.formState.errors.password)}
            disabled={form.formState.isSubmitting}
            {...form.register('password')}
          />
          <FieldError errors={[form.formState.errors.password]} />
        </Field>
        <input type='hidden' {...form.register('callbackUrl')} />
        <Button
          type='submit'
          className='w-full'
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting && <Spinner data-icon='inline-start' />}
          登录
        </Button>
      </FieldGroup>
    </form>
  )
}
