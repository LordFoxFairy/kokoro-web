'use client'

import Link from 'next/link'
import { ChevronsUpDown, LogOut, Settings2 } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

type NavUserAction = {
  href?: string
  onSelect?: () => void
}

type NavUserProps = {
  user: {
    name: string
    email: string
    fallback: string
  }
  accountSettings?: NavUserAction
  onSignOut?: () => void
}

export function NavUser({ user, accountSettings, onSignOut }: NavUserProps) {
  const { isMobile } = useSidebar()
  const accountSettingsAvailable = Boolean(
    accountSettings?.href || accountSettings?.onSelect
  )
  const actionsAvailable = accountSettingsAvailable || Boolean(onSignOut)

  const userSummary = (
    <>
      <Avatar className='size-8 rounded-md'>
        <AvatarFallback className='rounded-md'>{user.fallback}</AvatarFallback>
      </Avatar>
      <span className='grid flex-1 text-left text-sm leading-tight'>
        <span className='truncate font-medium'>{user.name}</span>
        <span className='truncate text-xs text-muted-foreground'>
          {user.email}
        </span>
      </span>
    </>
  )

  if (!actionsAvailable) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size='lg' asChild>
            <div>{userSummary}</div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size='lg'
              className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
            >
              {userSummary}
              <ChevronsUpDown aria-hidden='true' className='ml-auto size-4' />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? 'bottom' : 'right'}
            align='end'
            sideOffset={4}
            className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-md'
          >
            <DropdownMenuLabel className='p-0 font-normal'>
              <div className='grid gap-0.5 px-2 py-1.5 text-left text-sm'>
                <span className='font-medium'>{user.name}</span>
                <span className='truncate text-xs text-muted-foreground'>
                  {user.email}
                </span>
              </div>
            </DropdownMenuLabel>
            {accountSettingsAvailable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {accountSettings?.href ? (
                    <DropdownMenuItem asChild>
                      <Link href={accountSettings.href}>
                        <Settings2 aria-hidden='true' />
                        账户设置
                      </Link>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={accountSettings?.onSelect}>
                      <Settings2 aria-hidden='true' />
                      账户设置
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
              </>
            )}
            {onSignOut && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant='destructive' onSelect={onSignOut}>
                  <LogOut aria-hidden='true' />
                  退出登录
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
