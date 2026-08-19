import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataGrid, type GridRow } from './data-grid'

const columns = ['用户', '邮箱', '状态'] as const
const rows: readonly GridRow[] = [
  {
    id: 'usr_ada',
    cells: [
      { text: 'Ada', href: '/users/usr_ada' },
      { text: 'ada@example.test' },
      { text: '正常', status: 'active' },
    ],
  },
]

function renderGrid(gridRows: readonly GridRow[] = rows) {
  return render(
    <DataGrid columns={columns} rows={gridRows} searchPlaceholder='搜索用户' />
  )
}

function openColumnSettings() {
  fireEvent.pointerDown(screen.getByRole('button', { name: '列设置' }), {
    button: 0,
    ctrlKey: false,
  })
}

describe('DataGrid columns', () => {
  it('limits column settings to the desktop table surface', () => {
    renderGrid()

    expect(screen.getByRole('button', { name: '列设置' }).className).toContain(
      'hidden'
    )
  })

  it('keeps the primary column visible and out of column settings', () => {
    renderGrid()
    openColumnSettings()

    expect(screen.queryByRole('menuitemcheckbox', { name: '用户' })).toBeNull()
    expect(
      screen.getByRole('menuitemcheckbox', { name: '邮箱' })
    ).not.toBeNull()

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '邮箱' }))
    openColumnSettings()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '状态' }))

    expect(
      within(screen.getByRole('table')).getByRole('columnheader', {
        name: /用户/,
      })
    ).not.toBeNull()
  })
})

describe('DataGrid empty states', () => {
  it('shows an initial empty state when the source has no rows', () => {
    renderGrid([])

    expect(screen.getAllByText('暂无记录').length).toBeGreaterThan(0)
    expect(screen.queryByText('没有匹配记录')).toBeNull()
  })

  it('shows a no-results state after search removes all rows', () => {
    renderGrid()

    fireEvent.change(screen.getByRole('textbox', { name: '搜索用户' }), {
      target: { value: 'nobody' },
    })

    expect(screen.getAllByText('没有匹配记录').length).toBeGreaterThan(0)
    expect(screen.queryByText('暂无记录')).toBeNull()
  })
})

describe('DataGrid responsive detail', () => {
  it('keeps the TanStack-backed desktop table', () => {
    renderGrid()

    expect(screen.getByRole('table')).not.toBeNull()
    expect(
      within(screen.getByRole('table')).getByRole('cell', { name: 'Ada' })
    ).not.toBeNull()
  })

  it('opens row details in a Sheet and exposes the real detail link', () => {
    renderGrid()

    fireEvent.click(screen.getByRole('button', { name: '查看 Ada 详情' }))

    const sheet = screen.getByRole('dialog', { name: 'Ada' })
    expect(within(sheet).getByText('ada@example.test')).not.toBeNull()
    expect(
      within(sheet)
        .getByRole('link', { name: '查看完整详情' })
        .getAttribute('href')
    ).toBe('/users/usr_ada')
  })

  it('does not invent a detail link for a row without href', () => {
    renderGrid([
      {
        id: 'role_reader',
        cells: [
          { text: 'Reader' },
          { text: 'reader@example.test' },
          { text: '正常', status: 'active' },
        ],
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: '查看 Reader 详情' }))

    expect(screen.queryByRole('link', { name: '查看完整详情' })).toBeNull()
  })
})
