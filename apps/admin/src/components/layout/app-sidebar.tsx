'use client'

import Link from 'next/link'
import { Shield } from 'lucide-react'
import type { SessionView } from '@/lib/auth/session'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { consoleNav } from './nav-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'

type AppSidebarProps = {
  readonly session: SessionView
  readonly onSignOut?: () => void | Promise<void>
}

export function AppSidebar({ session, onSignOut }: AppSidebarProps) {
  const { setOpenMobile } = useSidebar()

  return (
    <Sidebar collapsible='icon' variant='inset'>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size='lg' asChild>
              <Link href='/' onClick={() => setOpenMobile(false)}>
                <span className='flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground'>
                  <Shield aria-hidden='true' />
                </span>
                <span className='grid flex-1 text-left leading-tight'>
                  <span className='truncate font-semibold'>Kokoro</span>
                  <span className='truncate text-xs text-muted-foreground'>
                    管理控制台
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <NavGroup title='管理' items={consoleNav} />
      </SidebarContent>

      <SidebarFooter>
        <NavUser
          user={{
            name: session.user.displayName,
            email: session.user.email,
            fallback: session.user.displayName.slice(0, 1),
          }}
          onSignOut={onSignOut}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
