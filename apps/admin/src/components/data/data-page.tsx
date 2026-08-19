import Link from 'next/link'
import { Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type DataRow = {
  id: string
  cells: readonly React.ReactNode[]
  href?: string
}

type DataPageProps = {
  title: string
  description: string
  columns: readonly string[]
  rows: readonly DataRow[]
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

      <div className='flex flex-wrap items-center gap-2'>
        <form className='relative w-full sm:w-72'>
          <Search
            aria-hidden='true'
            className='pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground'
          />
          <Input
            name='q'
            className='pl-8'
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </form>
        <Badge variant='outline'>{rows.length} 条记录</Badge>
      </div>

      <div className='min-w-0 overflow-hidden rounded-lg border bg-background'>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {row.cells.map((cell, index) => (
                    <TableCell key={`${row.id}-${columns[index]}`}>
                      {index === 0 && row.href ? (
                        <Link
                          href={row.href}
                          className='font-medium underline-offset-4 hover:underline'
                        >
                          {cell}
                        </Link>
                      ) : (
                        cell
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </main>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    active: '正常',
    suspended: '已停用',
    deleted: '已删除',
    expired: '已过期',
    revoked: '已撤销',
    success: '成功',
    denied: '拒绝',
    failure: '失败',
  }
  return (
    <Badge
      variant={
        ['suspended', 'revoked', 'denied', 'failure'].includes(status)
          ? 'destructive'
          : 'secondary'
      }
    >
      {labels[status] ?? status}
    </Badge>
  )
}
