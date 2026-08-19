import type { AdminRoute, NavCapabilityRules } from '../../config'
import {
  loadCapabilities,
  loadCurrentIdentity,
} from '../../features/identity/load'
import { resolveSafeCallbackUrl } from '../auth/redirect'
import { decideRouteAccess } from '../auth/route-access'
import type { SessionView } from '../auth/session'
import type { PageError, PageState } from '../page-state'
import type {
  AdminDataClient,
  CapabilityProjection,
  CurrentIdentity,
  RequestContext,
  Scope,
} from '../view-models'

type ParallelSource = 'identity' | 'capabilities' | 'content'

export type AdminPageOutcome<T> =
  | {
      readonly kind: 'redirect'
      readonly reason: 'unauthenticated'
      readonly source: 'route' | ParallelSource
      readonly destination: '/login'
      readonly callbackUrl: string
    }
  | {
      readonly kind: 'forbidden'
      readonly reason: 'route' | ParallelSource
    }
  | { readonly kind: 'not-found'; readonly reason: 'route' | 'content' }
  | {
      readonly kind: 'render'
      readonly route: AdminRoute
      readonly quality: 'ready' | 'partial' | 'failed'
      readonly identity: PageState<CurrentIdentity>
      readonly capabilities: PageState<CapabilityProjection>
      readonly content: PageState<T>
    }

export interface AdminPageInput<T> {
  readonly pathname: string
  readonly requestedUrl?: string
  readonly appOrigin: string
  readonly session: SessionView | null
  readonly capabilityRules: NavCapabilityRules
  readonly client: AdminDataClient
  readonly scope: Scope
  readonly context?: RequestContext
  readonly loadContent: (
    client: AdminDataClient,
    scope: Scope,
    context?: RequestContext
  ) => Promise<PageState<T>>
  readonly now?: Date
}

function safeCallbackUrl<T>(input: AdminPageInput<T>): string {
  return resolveSafeCallbackUrl(
    input.requestedUrl ?? input.pathname,
    input.appOrigin
  )
}

function terminalSource<T>(
  states: Readonly<{
    identity: PageState<CurrentIdentity>
    capabilities: PageState<CapabilityProjection>
    content: PageState<T>
  }>,
  status: 'unauthenticated' | 'forbidden'
): ParallelSource | undefined {
  if (states.identity.status === status) return 'identity'
  if (states.capabilities.status === status) return 'capabilities'
  if (states.content.status === status) return 'content'
  return undefined
}

function renderQuality<T>(
  identity: PageState<CurrentIdentity>,
  capabilities: PageState<CapabilityProjection>,
  content: PageState<T>
): 'ready' | 'partial' | 'failed' {
  const shellFailed = [identity.status, capabilities.status].some(
    (status) => status !== 'ready' && status !== 'partial'
  )
  const contentFailed =
    content.status === 'error' || content.status === 'loading'

  if (shellFailed || contentFailed) return 'failed'
  if (
    identity.status === 'partial' ||
    capabilities.status === 'partial' ||
    content.status === 'partial'
  ) {
    return 'partial'
  }
  return 'ready'
}

function stateData<T>(state: PageState<T>): T | undefined {
  return state.status === 'ready' || state.status === 'partial'
    ? state.data
    : undefined
}

function hasConsistentSubject(
  session: SessionView,
  identity: PageState<CurrentIdentity>,
  capabilities: PageState<CapabilityProjection>
): boolean {
  const identityData = stateData(identity)
  const capabilityData = stateData(capabilities)

  return (
    (identityData === undefined || identityData.id === session.user.id) &&
    (capabilityData === undefined ||
      capabilityData.subjectId === session.user.id)
  )
}

function subjectConsistencyFailure<T>(requestId?: string): PageState<T> {
  const error: PageError = {
    code: 'FAILED_PRECONDITION',
    fieldViolations: [],
    requestId: requestId ?? 'admin.subject-consistency',
    retryable: false,
  }

  return { status: 'error', error }
}

/**
 * Coordinates a protected Admin server page without depending on a rendering
 * framework or an authentication implementation. IAM remains the final
 * authority; the route decision is only an early UI access check.
 */
export async function orchestrateAdminPage<T>(
  input: AdminPageInput<T>
): Promise<AdminPageOutcome<T>> {
  const access = decideRouteAccess({
    pathname: input.pathname,
    requestedUrl: input.requestedUrl,
    appOrigin: input.appOrigin,
    session: input.session,
    capabilityRules: input.capabilityRules,
    now: input.now,
  })

  switch (access.kind) {
    case 'login':
      return {
        kind: 'redirect',
        reason: 'unauthenticated',
        source: 'route',
        destination: '/login',
        callbackUrl: access.callbackUrl,
      }
    case 'forbidden':
      return { kind: 'forbidden', reason: 'route' }
    case 'not-found':
      return { kind: 'not-found', reason: 'route' }
    case 'allow':
      if (access.route === null) {
        return { kind: 'not-found', reason: 'route' }
      }
      break
  }

  const [identity, capabilities, content] = await Promise.all([
    loadCurrentIdentity(input.client, input.context),
    loadCapabilities(input.client, input.scope, input.context),
    input.loadContent(input.client, input.scope, input.context),
  ])

  const states = { identity, capabilities, content }
  const unauthenticated = terminalSource(states, 'unauthenticated')
  if (unauthenticated) {
    return {
      kind: 'redirect',
      reason: 'unauthenticated',
      source: unauthenticated,
      destination: '/login',
      callbackUrl: safeCallbackUrl(input),
    }
  }

  const forbidden = terminalSource(states, 'forbidden')
  if (forbidden) return { kind: 'forbidden', reason: forbidden }

  if (
    input.session !== null &&
    !hasConsistentSubject(input.session, identity, capabilities)
  ) {
    return {
      kind: 'render',
      route: access.route,
      quality: 'failed',
      identity: subjectConsistencyFailure(input.context?.requestId),
      capabilities: subjectConsistencyFailure(input.context?.requestId),
      content: subjectConsistencyFailure(input.context?.requestId),
    }
  }

  if (content.status === 'not-found') {
    return { kind: 'not-found', reason: 'content' }
  }

  return {
    kind: 'render',
    route: access.route,
    quality: renderQuality(identity, capabilities, content),
    identity,
    capabilities,
    content,
  }
}
