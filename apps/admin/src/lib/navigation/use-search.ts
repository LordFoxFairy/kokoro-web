'use client'

import { useSearchParams } from 'next/navigation'

export function useSearch(): ReturnType<typeof useSearchParams> {
  return useSearchParams()
}
