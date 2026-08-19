import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type MainProps = ComponentProps<'div'> & {
  fixed?: boolean
  fluid?: boolean
}

export function Main({
  className,
  fixed = false,
  fluid = false,
  ...props
}: MainProps) {
  return (
    <div
      data-slot='layout-main'
      data-fluid={fluid || undefined}
      data-layout={fixed ? 'fixed' : 'auto'}
      className={cn(
        'min-w-0 px-4 py-6 md:px-6',
        fixed && 'flex min-h-0 flex-1 flex-col overflow-auto',
        !fluid &&
          '@7xl/content:mx-auto @7xl/content:w-full @7xl/content:max-w-7xl',
        className
      )}
      {...props}
    />
  )
}
