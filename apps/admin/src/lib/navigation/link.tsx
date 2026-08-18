'use client'

import { type AnchorHTMLAttributes } from 'react'
import NextLink, { type LinkProps as NextLinkProps } from 'next/link'

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> &
  Omit<NextLinkProps, 'href'> & {
    to: NextLinkProps['href']
  }

export function Link({ to, ...props }: LinkProps) {
  return <NextLink href={to} {...props} />
}
