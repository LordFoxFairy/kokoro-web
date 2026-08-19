import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type SkipToMainProps = ComponentProps<'a'>

export function SkipToMain({ className, ...props }: SkipToMainProps) {
  return (
    <a
      className={cn(
        'fixed top-3 left-4 z-50 -translate-y-16 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-transform focus:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
        className
      )}
      href='#main-content'
      {...props}
    >
      跳到主要内容
    </a>
  )
}
