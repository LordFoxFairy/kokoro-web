'use client'

import { SearchProvider } from '@/context/search-provider'
import type { SessionView } from '@/lib/auth/session'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { SkipToMain } from '@/components/skip-to-main'
import { Header } from './header'

type AppShellProps = {
  readonly children: React.ReactNode
  readonly session: SessionView
  readonly onSignOut?: () => void | Promise<void>
}

export function AppShell({ children, session, onSignOut }: AppShellProps) {
  return (
    <SearchProvider>
      <SidebarProvider>
        <SkipToMain />
        <AppSidebar session={session} onSignOut={onSignOut} />
        <SidebarInset className='@container/content h-svh min-h-0 min-w-0 overflow-hidden md:h-[calc(100svh-1rem)]'>
          <Header />
          <div
            id='main-content'
            tabIndex={-1}
            className='flex min-h-0 flex-1 flex-col overflow-auto'
          >
            <div className='flex min-h-full w-full min-w-0 flex-col'>
              {children}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </SearchProvider>
  )
}
