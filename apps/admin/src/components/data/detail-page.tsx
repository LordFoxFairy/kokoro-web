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

type DetailPageProps = {
  backHref: string
  backLabel: string
  title: string
  subtitle: string
  status: string
  fields: readonly { label: string; value: React.ReactNode }[]
}

export function DetailPage({
  backHref,
  backLabel,
  title,
  subtitle,
  status,
  fields,
}: DetailPageProps) {
  return (
    <main id='content' className='flex flex-1 flex-col gap-5 p-4 md:p-6'>
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
              <Badge variant='secondary'>{status}</Badge>
            </div>
            <p className='mt-1 text-sm text-muted-foreground'>{subtitle}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='outline' size='icon-sm' aria-label='更多操作'>
                <MoreHorizontal aria-hidden='true' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem>编辑</DropdownMenuItem>
              <DropdownMenuItem variant='destructive'>停用</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
    </main>
  )
}
