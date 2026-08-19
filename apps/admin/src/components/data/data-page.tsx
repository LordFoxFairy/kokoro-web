import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataGrid, type GridRow } from '@/components/data/data-grid'

type DataPageProps = {
  title: string
  description: string
  columns: readonly string[]
  rows: readonly GridRow[]
  actionLabel?: string
  searchPlaceholder?: string
}

export function DataPage({
  title,
  description,
  columns,
  rows,
  actionLabel,
  searchPlaceholder = '搜索...',
}: DataPageProps) {
  return (
    <main
      id='content'
      className='flex min-w-0 flex-1 flex-col gap-5 p-4 md:p-6'
    >
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold'>{title}</h1>
          <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
        </div>
        {actionLabel && (
          <Button size='sm'>
            <Plus data-icon='inline-start' aria-hidden='true' />
            {actionLabel}
          </Button>
        )}
      </div>
      <DataGrid
        columns={columns}
        rows={rows}
        searchPlaceholder={searchPlaceholder}
      />
    </main>
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
