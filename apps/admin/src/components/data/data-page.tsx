import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataGrid, type GridRow } from '@/components/data/data-grid'
import { Main } from '@/components/layout/main'

type DataPageProps = {
  title: string
  description: string
  columns: readonly string[]
  rows: readonly GridRow[]
  actionLabel?: string
  actionHref?: string
  onAction?: () => void
  searchPlaceholder?: string
}

export function DataPage({
  title,
  description,
  columns,
  rows,
  actionLabel,
  actionHref,
  onAction,
  searchPlaceholder = '搜索...',
}: DataPageProps) {
  return (
    <Main className='flex min-w-0 flex-1 flex-col gap-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold'>{title}</h1>
          <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
        </div>
        {actionLabel && actionHref ? (
          <Button size='sm' asChild>
            <Link href={actionHref}>
              <Plus data-icon='inline-start' aria-hidden='true' />
              {actionLabel}
            </Link>
          </Button>
        ) : actionLabel && onAction ? (
          <Button size='sm' onClick={onAction}>
            <Plus data-icon='inline-start' aria-hidden='true' />
            {actionLabel}
          </Button>
        ) : null}
      </div>
      <DataGrid
        columns={columns}
        rows={rows}
        searchPlaceholder={searchPlaceholder}
      />
    </Main>
  )
}

export function statusLabel(status: string) {
  return (
    (
      {
        active: '正常',
        suspended: '已停用',
        deleted: '已删除',
        expired: '已过期',
        revoked: '已撤销',
        success: '成功',
        denied: '拒绝',
        failure: '失败',
      } as Record<string, string>
    )[status] ?? status
  )
}
