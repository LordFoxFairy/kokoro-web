import {
  canAccessNavItem,
  matchAdminRoute,
  type AdminRoute,
  type NavCapabilityRules,
} from '../../config'
import { resolveSafeAdminCallbackUrl } from './redirect'
import { isSessionExpired, type SessionView } from './session'

const PUBLIC_PATHS = new Set(['/login'])

export type RouteAccessDecision =
  | {
      readonly kind: 'allow'
      readonly reason: 'public'
      readonly route: null
    }
  | {
      readonly kind: 'allow'
      readonly reason: 'authorized'
      readonly route: AdminRoute
    }
  | {
      readonly kind: 'login'
      readonly callbackUrl: string
    }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not-found' }

export interface RouteAccessInput {
  readonly pathname: string
  readonly requestedUrl?: string
  readonly appOrigin: string
  readonly session: SessionView | null
  readonly capabilityRules: NavCapabilityRules
  readonly now?: Date
}

function normalizePublicPath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname
}

/**
 * Projects session capabilities into an Admin route decision.
 *
 * This controls frontend routing only. RPC handlers must independently enforce
 * authorization using the IAM contract and must not trust this result.
 */
export function decideRouteAccess({
  pathname,
  requestedUrl,
  appOrigin,
  session,
  capabilityRules,
  now,
}: RouteAccessInput): RouteAccessDecision {
  if (now !== undefined && Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date')
  }

  if (PUBLIC_PATHS.has(normalizePublicPath(pathname))) {
    return { kind: 'allow', reason: 'public', route: null }
  }

  const route = matchAdminRoute(pathname)
  if (!route) return { kind: 'not-found' }

  if (!session || isSessionExpired(session, now)) {
    return {
      kind: 'login',
      callbackUrl: resolveSafeAdminCallbackUrl(
        requestedUrl ?? pathname,
        appOrigin
      ),
    }
  }

  if (
    route.navItemId !== null &&
    !canAccessNavItem(route.navItemId, session.capabilities, capabilityRules)
  ) {
    return { kind: 'forbidden' }
  }

  return { kind: 'allow', reason: 'authorized', route }
}
