export type TableCursor = string
export type TableRowKey = string
export type TableColumnKey = string

export type TablePagination = Readonly<{
  pageSize: number
  cursor: TableCursor | null
  history: readonly (TableCursor | null)[]
}>

export type TableState = Readonly<{
  queryKey: string
  pagination: TablePagination
  selectedRowKeys: readonly TableRowKey[]
  columnKeys: readonly TableColumnKey[]
  visibleColumnKeys: readonly TableColumnKey[]
}>

export type CreateTableState = Readonly<{
  queryKey: string
  pageSize: number
  columnKeys: readonly TableColumnKey[]
  visibleColumnKeys?: readonly TableColumnKey[]
}>

function assertNonEmpty(value: string, name: string): void {
  if (value.length === 0) throw new Error(`${name} must not be empty`)
}

function assertPageSize(pageSize: number): void {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error('pageSize must be a positive integer')
  }
}

function assertUnique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${name} must be unique`)
  }
}

function assertColumns(
  columnKeys: readonly TableColumnKey[],
  visibleColumnKeys: readonly TableColumnKey[]
): void {
  if (columnKeys.length === 0) throw new Error('columnKeys must not be empty')
  columnKeys.forEach((columnKey) => assertNonEmpty(columnKey, 'columnKey'))
  assertUnique(columnKeys, 'columnKeys')
  assertUnique(visibleColumnKeys, 'visibleColumnKeys')

  if (visibleColumnKeys.length === 0) {
    throw new Error('at least one column must remain visible')
  }

  const knownColumns = new Set(columnKeys)
  const unknownColumn = visibleColumnKeys.find(
    (columnKey) => !knownColumns.has(columnKey)
  )
  if (unknownColumn !== undefined) {
    throw new Error(`unknown columnKey: ${unknownColumn}`)
  }
}

export function createTableState(input: CreateTableState): TableState {
  assertNonEmpty(input.queryKey, 'queryKey')
  assertPageSize(input.pageSize)

  const columnKeys = [...input.columnKeys]
  const requestedVisibleColumns = input.visibleColumnKeys ?? columnKeys
  assertColumns(columnKeys, requestedVisibleColumns)
  const visibleColumns = new Set(requestedVisibleColumns)

  return {
    queryKey: input.queryKey,
    pagination: { pageSize: input.pageSize, cursor: null, history: [] },
    selectedRowKeys: [],
    columnKeys,
    visibleColumnKeys: columnKeys.filter((columnKey) =>
      visibleColumns.has(columnKey)
    ),
  }
}

export function moveNext(
  state: TableState,
  nextCursor: TableCursor
): TableState {
  assertNonEmpty(nextCursor, 'nextCursor')

  return {
    ...state,
    pagination: {
      ...state.pagination,
      cursor: nextCursor,
      history: [...state.pagination.history, state.pagination.cursor],
    },
  }
}

export function moveBack(state: TableState): TableState {
  const previousCursor = state.pagination.history.at(-1)
  if (previousCursor === undefined) return state

  return {
    ...state,
    pagination: {
      ...state.pagination,
      cursor: previousCursor,
      history: state.pagination.history.slice(0, -1),
    },
  }
}

export function setPageSize(state: TableState, pageSize: number): TableState {
  assertPageSize(pageSize)
  if (pageSize === state.pagination.pageSize) return state

  return {
    ...state,
    pagination: { pageSize, cursor: null, history: [] },
  }
}

export function setRowSelected(
  state: TableState,
  rowKey: TableRowKey,
  selected: boolean
): TableState {
  assertNonEmpty(rowKey, 'rowKey')
  const isSelected = state.selectedRowKeys.includes(rowKey)
  if (selected === isSelected) return state

  return {
    ...state,
    selectedRowKeys: selected
      ? [...state.selectedRowKeys, rowKey]
      : state.selectedRowKeys.filter((candidate) => candidate !== rowKey),
  }
}

export function toggleRowSelected(
  state: TableState,
  rowKey: TableRowKey
): TableState {
  assertNonEmpty(rowKey, 'rowKey')
  return setRowSelected(state, rowKey, !state.selectedRowKeys.includes(rowKey))
}

export function setColumnVisible(
  state: TableState,
  columnKey: TableColumnKey,
  visible: boolean
): TableState {
  if (!state.columnKeys.includes(columnKey)) {
    throw new Error(`unknown columnKey: ${columnKey}`)
  }

  const isVisible = state.visibleColumnKeys.includes(columnKey)
  if (visible === isVisible) return state
  if (!visible && state.visibleColumnKeys.length === 1) {
    throw new Error('at least one column must remain visible')
  }

  const nextVisibleColumns = visible
    ? new Set([...state.visibleColumnKeys, columnKey])
    : new Set(
        state.visibleColumnKeys.filter((candidate) => candidate !== columnKey)
      )

  return {
    ...state,
    visibleColumnKeys: state.columnKeys.filter((candidate) =>
      nextVisibleColumns.has(candidate)
    ),
  }
}

export function setTableQuery(state: TableState, queryKey: string): TableState {
  assertNonEmpty(queryKey, 'queryKey')
  if (queryKey === state.queryKey) return state

  return {
    ...state,
    queryKey,
    pagination: {
      pageSize: state.pagination.pageSize,
      cursor: null,
      history: [],
    },
    selectedRowKeys: [],
  }
}
