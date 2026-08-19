'use client'

import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type SkipToMainProps = ComponentProps<'a'>

export function SkipToMain({ className, onClick, ...props }: SkipToMainProps) {
  const focusMain = () => {
    const target = document.getElementById('main-content')
    if (!target) return false

    target.focus()
    target.scrollIntoView({ block: 'start', inline: 'nearest' })
    window.setTimeout(() => target.focus(), 0)
    return true
  }

  const handleMouseDown: React.MouseEventHandler<HTMLAnchorElement> = (
    event
  ) => {
    event.preventDefault()
    focusMain()
  }

  const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event)
    event.preventDefault()
    focusMain()
  }

  const handleKeyDown: React.KeyboardEventHandler<HTMLAnchorElement> = (
    event
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    focusMain()
  }

  const handleKeyUp: React.KeyboardEventHandler<HTMLAnchorElement> = (
    event
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    focusMain()
  }

  return (
    <a
      className={cn(
        'fixed top-3 left-4 z-50 -translate-y-16 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-transform focus:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
        className
      )}
      href='#main-content'
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      {...props}
    >
      跳到主要内容
    </a>
  )
}
