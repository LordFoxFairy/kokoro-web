import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { NavUser } from './nav-user'

const user = {
  name: '平台管理员',
  email: 'admin@kokoro.local',
  fallback: '管',
}

function renderNavUser(
  props: Partial<React.ComponentProps<typeof NavUser>> = {}
) {
  return render(
    <SidebarProvider>
      <NavUser user={user} {...props} />
    </SidebarProvider>
  )
}

function openUserMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: /平台管理员/ }), {
    button: 0,
    ctrlKey: false,
  })
}

describe('NavUser', () => {
  it('omits account actions that have no executable behavior', () => {
    renderNavUser()

    expect(screen.queryByText(/暂不可用/)).toBeNull()
    expect(screen.queryByRole('button', { name: /平台管理员/ })).toBeNull()
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('renders and executes configured actions', () => {
    const onAccountSettings = vi.fn()
    const onSignOut = vi.fn()

    renderNavUser({
      accountSettings: { onSelect: onAccountSettings },
      onSignOut,
    })
    openUserMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: '账户设置' }))
    expect(onAccountSettings).toHaveBeenCalledOnce()

    openUserMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }))
    expect(onSignOut).toHaveBeenCalledOnce()
  })
})
