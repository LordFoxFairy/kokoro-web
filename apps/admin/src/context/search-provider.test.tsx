import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SearchProvider, useSearch } from './search-provider'

vi.mock('@/components/layout/command-menu', () => ({
  CommandMenu: () => {
    const { open } = useSearch()
    return <output aria-label='搜索状态'>{open ? '打开' : '关闭'}</output>
  },
}))

describe('SearchProvider', () => {
  it.each([
    ['Control', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
  ])('toggles search with %s+K', (_modifier, modifier) => {
    render(
      <SearchProvider>
        <div>页面</div>
      </SearchProvider>
    )

    expect(screen.getByLabelText('搜索状态').textContent).toBe('关闭')

    fireEvent.keyDown(document, { key: 'k', ...modifier })
    expect(screen.getByLabelText('搜索状态').textContent).toBe('打开')

    fireEvent.keyDown(document, { key: 'K', ...modifier })
    expect(screen.getByLabelText('搜索状态').textContent).toBe('关闭')
  })
})
