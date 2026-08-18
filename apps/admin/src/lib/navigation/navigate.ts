'use client'

import { useRouter } from 'next/navigation'
import { createNavigate, type Navigate } from './core'

export function useNavigate(): Navigate {
  const router = useRouter()
  return createNavigate(router)
}
