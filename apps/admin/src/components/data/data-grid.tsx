'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { ArrowUpDown, ChevronRight, Columns3, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type GridCell = { text: string; href?: string; status?: string }
export type GridRow = { id: string; cells: readonly GridCell[] }
type GridRecord = Record<string, GridCell> & { id: GridCell }

function StatusBadge({ status, text }: { status: string; text: string }) {
  return (
    <Badge
      variant={
        ['suspended', 'revoked', 'denied', 'failure'].includes(status)
          ? 'destructive'
          : 'secondary'
      }
    >
      {text}
    </Badge>
  )
}

function CellValue({
  cell,
  linked = true,
}: {
  cell: GridCell
  linked?: boolean
}) {
  if (cell.status) return <StatusBadge status={cell.status} text={cell.text} />
  if (cell.href && linked)
    return (
      <Link
        href={cell.href}
        className='font-medium underline-offset-4 hover:underline'
      >
        {cell.text}
      </Link>
    )
  return cell.text
}

export function DataGrid({
  columns,
  rows,
  searchPlaceholder,
}: {
  columns: readonly string[]
  rows: readonly GridRow[]
  searchPlaceholder: string
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [visibility, setVisibility] = useState<VisibilityState>({})
  const [query, setQuery] = useState('')
  const data = useMemo<GridRecord[]>(
    () =>
      rows.map((row) =>
        Object.assign(
          { id: { text: row.id } },
          Object.fromEntries(
            columns.map((column, index) => [column, row.cells[index]])
          )
        )
      ),
    [columns, rows]
  )
  const tableColumns = useMemo<ColumnDef<GridRecord>[]>(
    () =>
      columns.map((column, index) => ({
        id: column,
        enableHiding: index !== 0,
        accessorFn: (row) => row[column]?.text ?? '',
        header: ({ column: tableColumn }) => (
          <Button
            variant='ghost'
            size='sm'
            className='-ml-3 h-8'
            onClick={() =>
              tableColumn.toggleSorting(tableColumn.getIsSorted() === 'asc')
            }
          >
            {column}
            <ArrowUpDown aria-hidden='true' />
          </Button>
        ),
        cell: ({ row }) => {
          const cell = row.original[column]
          if (!cell) return null
          return <CellValue cell={cell} />
        },
      })),
    [columns]
  )
  // TanStack Table returns mutable controller functions by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: tableColumns,
    state: { sorting, columnVisibility: visibility, globalFilter: query },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    onGlobalFilterChange: setQuery,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })
  const emptyMessage = rows.length === 0 ? '暂无记录' : '没有匹配记录'

  return (
    <div className='flex min-w-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative w-full sm:w-72'>
          <Search
            aria-hidden='true'
            className='pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground'
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className='pl-8'
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </div>
        <Badge variant='outline'>
          {table.getFilteredRowModel().rows.length} 条记录
        </Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='outline'
              size='sm'
              className='ml-auto hidden md:inline-flex'
            >
              <Columns3 data-icon='inline-start' aria-hidden='true' />
              列设置
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuLabel>显示列</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllLeafColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) =>
                    column.toggleVisibility(Boolean(value))
                  }
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className='grid gap-2 md:hidden'>
        {table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => {
            const primaryCell = row.original[columns[0]] ?? { text: row.id }
            const detailHref = columns
              .map((column) => row.original[column])
              .find((cell) => cell?.href)?.href

            return (
              <Sheet key={row.id}>
                <SheetTrigger asChild>
                  <Button
                    variant='outline'
                    className='h-auto w-full justify-between px-3 py-3 text-left whitespace-normal'
                    aria-label={`查看 ${primaryCell.text} 详情`}
                  >
                    <span className='min-w-0 truncate font-medium'>
                      {primaryCell.text}
                    </span>
                    <ChevronRight aria-hidden='true' />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side='bottom'
                  className='max-h-[85svh] overflow-y-auto rounded-t-lg'
                >
                  <SheetHeader>
                    <SheetTitle>{primaryCell.text}</SheetTitle>
                    <SheetDescription>{row.original.id.text}</SheetDescription>
                  </SheetHeader>
                  <dl className='grid gap-4 px-4 pb-4'>
                    {columns.map((column) => {
                      const cell = row.original[column]
                      if (!cell) return null
                      return (
                        <div key={column} className='min-w-0'>
                          <dt className='text-xs font-medium text-muted-foreground'>
                            {column}
                          </dt>
                          <dd className='mt-1 text-sm break-words'>
                            <CellValue cell={cell} linked={false} />
                          </dd>
                        </div>
                      )
                    })}
                  </dl>
                  {detailHref && (
                    <SheetFooter>
                      <Button asChild>
                        <Link href={detailHref}>查看完整详情</Link>
                      </Button>
                    </SheetFooter>
                  )}
                </SheetContent>
              </Sheet>
            )
          })
        ) : (
          <div className='rounded-lg border bg-background px-4 py-12 text-center text-sm text-muted-foreground'>
            {emptyMessage}
          </div>
        )}
      </div>
      <div className='hidden min-w-0 overflow-hidden rounded-lg border bg-background md:block'>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={table.getVisibleLeafColumns().length}
                    className='h-28 text-center text-muted-foreground'
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
