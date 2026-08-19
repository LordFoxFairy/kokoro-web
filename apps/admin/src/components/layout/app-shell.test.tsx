import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseSessionView } from '@/lib/auth/session'
import { AppShell } from './app-shell'
import { Main } from './main'

vi.mock('@/components/layout/app-sidebar', () => ({
  AppSidebar: () => <aside aria-label='管理导航' />,
}))

vi.mock('@/components/layout/header', () => ({
  Header: () => <header>页头</header>,
}))

vi.mock('@/context/search-provider', () => ({
  SearchProvider: ({ children }: { children: React.ReactNode }) => children,
}))

describe('AppShell', () => {
  const session = parseSessionView({
    user: {
      id: 'usr_test',
      displayName: 'Test User',
      email: 'test@example.test',
    },
    expiresAt: '2099-08-19T13:00:00.000Z',
    capabilities: [],
  })

  it('uses SidebarInset as the single main landmark and skip target', () => {
    render(
      <AppShell session={session}>
        <Main>页面内容</Main>
      </AppShell>
    )

    const main = screen.getByRole('main')
    const content = screen.getByText('页面内容').closest('#main-content')

    expect(main.getAttribute('data-slot')).toBe('sidebar-inset')
    expect(main.id).toBe('')
    expect(main.className).toContain('md:h-[calc(100svh-1rem)]')
    expect(content).not.toBeNull()
    expect((content as HTMLElement).tabIndex).toBe(-1)
    expect(
      main.compareDocumentPosition(content as HTMLElement) &
        Node.DOCUMENT_POSITION_CONTAINED_BY
    ).not.toBe(0)
    expect(
      screen.getByRole('link', { name: '跳到主要内容' }).getAttribute('href')
    ).toBe('#main-content')
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })
})
