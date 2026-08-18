import { pageStateFromError, type PageState } from '../../lib/page-state'
import type {
  AdminDataClient,
  CapabilityProjection,
  CurrentIdentity,
  RequestContext,
  Scope,
} from '../../lib/view-models'

export async function loadCurrentIdentity(
  client: Pick<AdminDataClient, 'getCurrentIdentity'>,
  context?: RequestContext
): Promise<PageState<CurrentIdentity>> {
  try {
    const result = await client.getCurrentIdentity(context)
    return { status: 'ready', data: result.data }
  } catch (error) {
    return pageStateFromError(
      error,
      context?.requestId ?? 'admin.current-identity'
    )
  }
}

export async function loadCapabilities(
  client: Pick<AdminDataClient, 'getCapabilities'>,
  scope: Scope,
  context?: RequestContext
): Promise<PageState<CapabilityProjection>> {
  try {
    const result = await client.getCapabilities(scope, context)
    return { status: 'ready', data: result.data }
  } catch (error) {
    return pageStateFromError(error, context?.requestId ?? 'admin.capabilities')
  }
}
