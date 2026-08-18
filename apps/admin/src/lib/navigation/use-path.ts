'use client'

import { usePathname } from 'next/navigation'

export function usePath(): string {
  return usePathname()
}
