'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { DirectionProvider } from '@/context/direction-provider'
import { FontProvider } from '@/context/font-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { Dashboard } from '@/features/dashboard'

function createDashboardRouter() {
  const rootRoute = createRootRoute({ component: Outlet })
  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <AuthenticatedLayout>
        <Dashboard />
      </AuthenticatedLayout>
    ),
  })

  return createRouter({
    routeTree: rootRoute.addChildren([dashboardRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

export function AdminDashboard() {
  const [queryClient] = useState(() => new QueryClient())
  const [router] = useState(createDashboardRouter)

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme='light'>
        <FontProvider>
          <DirectionProvider>
            <RouterProvider router={router} />
            <Toaster duration={5000} />
          </DirectionProvider>
        </FontProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
