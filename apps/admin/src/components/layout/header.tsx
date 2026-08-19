'use client'

import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { CommandMenuTrigger } from './command-menu'
import { ThemeSwitch } from './theme-switch'

type HeaderProps = ComponentProps<'header'>

export function Header({ className, ...props }: HeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 h-16 shrink-0 border-b bg-background',
        className
      )}
      {...props}
    >
      <div className='flex h-full items-center gap-3 px-4 sm:gap-4'>
        <SidebarTrigger variant='outline' size='icon-sm' />
        <Separator orientation='vertical' className='h-6' />
        <CommandMenuTrigger />
        <div className='ml-auto flex items-center gap-1'>
          <ThemeSwitch />
        </div>
      </div>
    </header>
  )
}
