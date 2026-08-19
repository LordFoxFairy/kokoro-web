'use client'

import { Separator } from '@/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { CommandMenu } from '@/components/layout/command-menu'
import { ThemeSwitch } from '@/components/layout/theme-switch'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <a
        href='#content'
        className='fixed top-3 left-4 z-50 -translate-y-16 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground transition-transform focus:translate-y-0'
      >
        跳到主要内容
      </a>
      <AppSidebar />
      <SidebarInset className='min-h-svh overflow-hidden'>
        <header className='sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80'>
          <SidebarTrigger variant='outline' size='icon-sm' />
          <Separator orientation='vertical' className='h-5' />
          <CommandMenu />
          <div className='ml-auto flex items-center gap-1'>
            <ThemeSwitch />
          </div>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
