import { describe, expect, it } from 'vitest'
import {
  createTableState,
  moveBack,
  moveNext,
  setColumnVisible,
  setPageSize,
  setRowSelected,
  setTableQuery,
  toggleRowSelected,
} from './table-state'

function tableState() {
  return createTableState({
    queryKey: 'status=active&sort=created_at.desc',
    pageSize: 25,
    columnKeys: ['name', 'status', 'createdAt'],
  })
}

describe('table cursor pagination', () => {
  it('keeps opaque cursors and walks the history stack', () => {
    const initial = tableState()
    const second = moveNext(initial, 'opaque:page-2')
    const third = moveNext(second, 'opaque:page-3')

    expect(initial.pagination).toEqual({
      pageSize: 25,
      cursor: null,
      history: [],
    })
    expect(second.pagination).toEqual({
      pageSize: 25,
      cursor: 'opaque:page-2',
      history: [null],
    })
    expect(third.pagination).toEqual({
      pageSize: 25,
      cursor: 'opaque:page-3',
      history: [null, 'opaque:page-2'],
    })
    expect(moveBack(third).pagination).toEqual(second.pagination)
    expect(moveBack(second).pagination).toEqual(initial.pagination)
    expect(moveBack(initial)).toBe(initial)
  })

  it('rejects an empty next cursor instead of interpreting it', () => {
    expect(() => moveNext(tableState(), '')).toThrowError(
      'nextCursor must not be empty'
    )
  })

  it('resets cursor history when page size changes', () => {
    const selected = setRowSelected(
      moveNext(tableState(), 'opaque:page-2'),
      'user_42',
      true
    )
    const changed = setPageSize(selected, 50)

    expect(changed.pagination).toEqual({
      pageSize: 50,
      cursor: null,
      history: [],
    })
    expect(changed.selectedRowKeys).toEqual(['user_42'])
    expect(setPageSize(changed, 50)).toBe(changed)
    expect(() => setPageSize(changed, 0)).toThrowError(
      'pageSize must be a positive integer'
    )
  })
})

describe('table row selection', () => {
  it('uses stable row keys and preserves them across cursor pages', () => {
    const selected = toggleRowSelected(tableState(), 'user_42')
    const nextPage = moveNext(selected, 'opaque:page-2')

    expect(nextPage.selectedRowKeys).toEqual(['user_42'])
    expect(toggleRowSelected(nextPage, 'user_42').selectedRowKeys).toEqual([])
  })

  it('is idempotent when setting an explicit selection state', () => {
    const selected = setRowSelected(tableState(), 'user_42', true)

    expect(setRowSelected(selected, 'user_42', true)).toBe(selected)
    expect(setRowSelected(selected, 'user_42', false).selectedRowKeys).toEqual(
      []
    )
    expect(() => toggleRowSelected(selected, '')).toThrowError(
      'rowKey must not be empty'
    )
  })
})

describe('table column visibility', () => {
  it('preserves declared column order while toggling visibility', () => {
    const hidden = setColumnVisible(tableState(), 'status', false)

    expect(hidden.visibleColumnKeys).toEqual(['name', 'createdAt'])
    expect(setColumnVisible(hidden, 'status', true).visibleColumnKeys).toEqual([
      'name',
      'status',
      'createdAt',
    ])
    expect(setColumnVisible(hidden, 'status', false)).toBe(hidden)
  })

  it('always retains at least one visible column', () => {
    const oneVisible = createTableState({
      queryKey: 'all',
      pageSize: 25,
      columnKeys: ['name', 'status'],
      visibleColumnKeys: ['name'],
    })

    expect(() => setColumnVisible(oneVisible, 'name', false)).toThrowError(
      'at least one column must remain visible'
    )
    expect(() => setColumnVisible(oneVisible, 'unknown', true)).toThrowError(
      'unknown columnKey: unknown'
    )
  })
})

describe('table query identity', () => {
  it('resets pagination and selection across queries but preserves columns', () => {
    const current = setColumnVisible(
      setRowSelected(moveNext(tableState(), 'opaque:page-2'), 'user_42', true),
      'status',
      false
    )
    const changed = setTableQuery(current, 'status=suspended')

    expect(changed.queryKey).toBe('status=suspended')
    expect(changed.pagination).toEqual({
      pageSize: 25,
      cursor: null,
      history: [],
    })
    expect(changed.selectedRowKeys).toEqual([])
    expect(changed.visibleColumnKeys).toEqual(['name', 'createdAt'])
    expect(setTableQuery(changed, 'status=suspended')).toBe(changed)
  })
})

describe('table state validation', () => {
  it('requires unique columns and a non-empty visible subset', () => {
    expect(() =>
      createTableState({
        queryKey: 'all',
        pageSize: 25,
        columnKeys: ['name', 'name'],
      })
    ).toThrowError('columnKeys must be unique')

    expect(() =>
      createTableState({
        queryKey: 'all',
        pageSize: 25,
        columnKeys: ['name'],
        visibleColumnKeys: [],
      })
    ).toThrowError('at least one column must remain visible')
  })
})
