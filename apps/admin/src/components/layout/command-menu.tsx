'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
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

export function CommandMenu() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
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
    </>
  )
}
