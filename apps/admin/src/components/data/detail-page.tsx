import Link from 'next/link'
import { ArrowLeft, MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { statusLabel } from '@/components/data/data-page'
import { Main } from '@/components/layout/main'

type DetailAction = {
  label: string
  href?: string
  onSelect?: () => void
  variant?: 'default' | 'destructive'
}

type DetailPageProps = {
  backHref: string
  backLabel: string
  title: string
  subtitle: string
  status: string
  fields: readonly { label: string; value: React.ReactNode }[]
  actions?: readonly DetailAction[]
}

export function DetailPage({
  backHref,
  backLabel,
  title,
  subtitle,
  status,
  fields,
  actions = [],
}: DetailPageProps) {
  const executableActions = actions.filter(
    (action) => action.href || action.onSelect
  )

  return (
    <Main className='flex flex-1 flex-col gap-5'>
      <div>
        <Button variant='ghost' size='sm' asChild className='mb-3 -ml-2'>
          <Link href={backHref}>
            <ArrowLeft data-icon='inline-start' aria-hidden='true' />
            {backLabel}
          </Link>
        </Button>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <div className='flex items-center gap-2'>
              <h1 className='text-2xl font-semibold'>{title}</h1>
              <Badge variant='secondary'>{statusLabel(status)}</Badge>
            </div>
            <p className='mt-1 text-sm text-muted-foreground'>{subtitle}</p>
          </div>
          {executableActions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='icon-sm' aria-label='更多操作'>
                  <MoreHorizontal aria-hidden='true' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {executableActions.map((action) =>
                  action.href ? (
                    <DropdownMenuItem
                      key={action.label}
                      variant={action.variant}
                      asChild
                    >
                      <Link href={action.href}>{action.label}</Link>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      key={action.label}
                      variant={action.variant}
                      onSelect={action.onSelect}
                    >
                      {action.label}
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <Card className='max-w-4xl rounded-lg shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className='grid gap-x-8 gap-y-5 sm:grid-cols-2'>
            {fields.map((field) => (
              <div key={field.label} className='min-w-0'>
                <dt className='text-xs font-medium text-muted-foreground'>
                  {field.label}
                </dt>
                <dd className='mt-1 truncate text-sm'>{field.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </Main>
  )
}
