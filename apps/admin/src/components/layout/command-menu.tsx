'use client'

import { useRouter } from 'next/navigation'
import { useSearch } from '@/context/search-provider'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { consoleNav } from './nav-data'

export function CommandMenuTrigger() {
  const { setOpen } = useSearch()

  return (
    <Button
      variant='outline'
      size='sm'
      className='h-8 w-40 justify-start bg-background text-muted-foreground shadow-none sm:w-56'
      onClick={() => setOpen(true)}
    >
      <Search data-icon='inline-start' aria-hidden='true' />
      搜索功能
      <kbd className='ml-auto hidden rounded border bg-muted px-1.5 text-[10px] sm:inline-flex'>
        ⌘K
      </kbd>
    </Button>
  )
}

export function CommandMenu() {
  const { open, setOpen } = useSearch()
  const router = useRouter()

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder='搜索页面或功能...' />
      <CommandList>
        <CommandEmpty>没有匹配结果</CommandEmpty>
        <CommandGroup heading='管理功能'>
          {consoleNav.map((item) => (
            <CommandItem
              key={item.href}
              value={`${item.title} ${item.description}`}
              onSelect={() => {
                setOpen(false)
                router.push(item.href)
              }}
            >
              <item.icon aria-hidden='true' />
              <span>{item.title}</span>
              <span className='ml-auto text-xs text-muted-foreground'>
                {item.description}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
