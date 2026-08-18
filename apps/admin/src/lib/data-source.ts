import { createFixtureAdminDataClient } from './fixtures'
import type { AdminDataClient } from './view-models'

export type AdminDataSourceEnvironment = Readonly<{
  ADMIN_DATA_SOURCE?: string
  NODE_ENV?: string
}>

export type AdminDataSourceErrorCode =
  'FIXTURE_NOT_ALLOWED' | 'INVALID_DATA_SOURCE' | 'NOT_CONFIGURED'

export class AdminDataSourceConfigurationError extends Error {
  readonly code: AdminDataSourceErrorCode

  constructor(code: AdminDataSourceErrorCode, message: string) {
    super(message)
    this.name = 'AdminDataSourceConfigurationError'
    this.code = code
  }
}

/** Selects an Admin data client without reading ambient process state. */
export function createAdminDataClient(
  env: AdminDataSourceEnvironment
): AdminDataClient {
  const dataSource = env.ADMIN_DATA_SOURCE

  if (dataSource === 'fixture') {
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
      throw new AdminDataSourceConfigurationError(
        'FIXTURE_NOT_ALLOWED',
        'ADMIN_DATA_SOURCE=fixture is only allowed when NODE_ENV is development or test'
      )
    }

    return createFixtureAdminDataClient()
  }

  if (dataSource === undefined || dataSource === '' || dataSource === 'rpc') {
    throw new AdminDataSourceConfigurationError(
      'NOT_CONFIGURED',
      'Admin RPC data source is NOT_CONFIGURED'
    )
  }

  throw new AdminDataSourceConfigurationError(
    'INVALID_DATA_SOURCE',
    `Unsupported ADMIN_DATA_SOURCE: ${dataSource}`
  )
}
