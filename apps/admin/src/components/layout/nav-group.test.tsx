import { fireEvent, render, screen } from '@testing-library/react'
import { Gauge } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { NavGroup } from './nav-group'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

function MobileSidebarState() {
  const { openMobile, setOpenMobile } = useSidebar()

  return (
    <>
      <button type='button' onClick={() => setOpenMobile(true)}>
        打开移动导航
      </button>
      <output aria-label='移动导航状态'>{openMobile ? '打开' : '关闭'}</output>
    </>
  )
}

describe('NavGroup', () => {
  it('closes the mobile sidebar after navigation', () => {
    render(
      <SidebarProvider>
        <MobileSidebarState />
        <NavGroup
          title='管理'
          items={[
            {
              title: '概览',
              href: '/',
              icon: Gauge,
              description: '平台概况',
            },
          ]}
        />
      </SidebarProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '打开移动导航' }))
    expect(screen.getByLabelText('移动导航状态').textContent).toBe('打开')

    fireEvent.click(screen.getByRole('link', { name: '概览' }))
    expect(screen.getByLabelText('移动导航状态').textContent).toBe('关闭')
  })
})
