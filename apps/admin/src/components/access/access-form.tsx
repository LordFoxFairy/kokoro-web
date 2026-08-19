'use client'

import { useState } from 'react'
import { z } from 'zod'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { SearchCheck } from 'lucide-react'
import { createFixtureAdminDataClient } from '@/lib/fixtures'
import {
  parseAdminError,
  type AccessCheck,
  type Scope,
} from '@/lib/view-models'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const formSchema = z
  .object({
    subjectId: z.string().trim().min(1, '请输入主体 ID'),
    scopeType: z.enum(['platform', 'organization', 'site']),
    scopeId: z.string().trim(),
    resource: z.string().trim().min(1, '请输入资源'),
    action: z.string().trim().min(1, '请输入动作'),
  })
  .superRefine((value, context) => {
    if (value.scopeType !== 'platform' && !value.scopeId)
      context.addIssue({
        code: 'custom',
        message: '请输入作用域 ID',
        path: ['scopeId'],
      })
  })
type FormValues = z.infer<typeof formSchema>
type ResultState =
  | { status: 'idle' }
  | { status: 'ready'; data: AccessCheck; requestId: string }
  | { status: 'error'; code: string; requestId: string }

function scopeFor(values: FormValues): Scope {
  return values.scopeType === 'platform'
    ? { type: 'platform' }
    : { type: values.scopeType, id: values.scopeId }
}

export function AccessForm() {
  const [result, setResult] = useState<ResultState>({ status: 'idle' })
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    control,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subjectId: 'usr_ada',
      scopeType: 'platform',
      scopeId: '',
      resource: 'users',
      action: 'read',
    },
  })
  const scopeType = useWatch({ control, name: 'scopeType' })
  async function submit(values: FormValues) {
    try {
      const response = await createFixtureAdminDataClient().checkAccess({
        subjectId: values.subjectId,
        scope: scopeFor(values),
        resource: values.resource,
        action: values.action,
      })
      setResult({
        status: 'ready',
        data: response.data,
        requestId: response.requestId,
      })
    } catch (error) {
      const parsed = parseAdminError(error)
      setResult({
        status: 'error',
        code: parsed?.businessCode ?? parsed?.code ?? 'UNKNOWN',
        requestId: parsed?.requestId ?? 'admin.access.check',
      })
    }
  }
  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]'>
      <Card className='rounded-lg shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>访问检查</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(submit)}
            className='grid gap-4 sm:grid-cols-2'
          >
            <Field label='主体 ID' error={errors.subjectId?.message}>
              <Input
                {...register('subjectId')}
                aria-invalid={Boolean(errors.subjectId)}
              />
            </Field>
            <Field label='作用域类型' error={errors.scopeType?.message}>
              <select
                {...register('scopeType')}
                className='h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
              >
                <option value='platform'>平台</option>
                <option value='organization'>组织</option>
                <option value='site'>Site</option>
              </select>
            </Field>
            {scopeType !== 'platform' && (
              <Field label='作用域 ID' error={errors.scopeId?.message}>
                <Input
                  {...register('scopeId')}
                  aria-invalid={Boolean(errors.scopeId)}
                />
              </Field>
            )}
            <Field label='资源' error={errors.resource?.message}>
              <Input
                {...register('resource')}
                aria-invalid={Boolean(errors.resource)}
              />
            </Field>
            <Field label='动作' error={errors.action?.message}>
              <Input
                {...register('action')}
                aria-invalid={Boolean(errors.action)}
              />
            </Field>
            <div className='sm:col-span-2'>
              <Button type='submit' disabled={isSubmitting}>
                <SearchCheck data-icon='inline-start' aria-hidden='true' />
                {isSubmitting ? '检查中...' : '执行检查'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className='rounded-lg shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>检查结果</CardTitle>
        </CardHeader>
        <CardContent>
          {result.status === 'idle' && (
            <p className='text-sm text-muted-foreground'>
              提交检查后在此显示 IAM 权威结果。
            </p>
          )}
          {result.status === 'ready' && (
            <div className='flex flex-col gap-4'>
              <Badge
                className='w-fit'
                variant={result.data.allowed ? 'secondary' : 'destructive'}
              >
                {result.data.allowed ? '允许' : '拒绝'}
              </Badge>
              <ResultItem label='原因码' value={result.data.reasonCode} />
              <ResultItem
                label='证据'
                value={result.data.evidence.join(', ') || '无'}
              />
              <ResultItem label='Request ID' value={result.requestId} />
            </div>
          )}
          {result.status === 'error' && (
            <div className='flex flex-col gap-4'>
              <Badge variant='destructive' className='w-fit'>
                检查失败
              </Badge>
              <ResultItem label='错误码' value={result.code} />
              <ResultItem label='Request ID' value={result.requestId} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className='flex flex-col gap-1.5 text-sm font-medium'>
      {label}
      {children}
      {error && (
        <span className='text-xs font-normal text-destructive'>{error}</span>
      )}
    </label>
  )
}
function ResultItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className='text-xs font-medium text-muted-foreground'>{label}</div>
      <div className='mt-1 text-sm break-all'>{value}</div>
    </div>
  )
}
