import { pageStateFromError, type PageState } from '../../lib/page-state'
import type {
  AdminDataClient,
  AuditEvent,
  DataResult,
  EntityId,
  RequestContext,
  Session,
} from '../../lib/view-models'

type SecurityDetail = {
  readonly sessions: Session
  readonly audit: AuditEvent
}

export type SecurityResource = keyof SecurityDetail

type DetailMethods = {
  readonly [Resource in SecurityResource]: (
    client: AdminDataClient,
    id: EntityId,
    context?: RequestContext
  ) => Promise<DataResult<SecurityDetail[Resource]>>
}

const METHODS: DetailMethods = {
  sessions: (client, id, context) => client.getSession(id, context),
  audit: (client, id, context) => client.getAuditEvent(id, context),
}

const FALLBACK_IDS = {
  sessions: 'req_admin_detail_sessions',
  audit: 'req_admin_detail_audit',
} as const satisfies Readonly<Record<SecurityResource, string>>

export async function loadSecurityDetail<Resource extends SecurityResource>(
  client: AdminDataClient,
  resource: Resource,
  id: EntityId,
  context?: RequestContext
): Promise<PageState<SecurityDetail[Resource]>> {
  try {
    const result = await METHODS[resource](client, id, context)
    return { status: 'ready', data: result.data }
  } catch (error: unknown) {
    return pageStateFromError(
      error,
      context?.requestId ?? FALLBACK_IDS[resource]
    )
  }
}
