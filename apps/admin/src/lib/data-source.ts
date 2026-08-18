import { isParsedAdminEnv, type AdminEnv } from './env'
import { createFixtureAdminDataClient } from './fixtures'
import {
  createScenarioFixtureAdminDataClient,
  type FixtureScenarioConfig,
} from './fixtures/scenario'
import type { AdminDataClient } from './view-models'

export type AdminDataClientOptions = Readonly<{
  fixtureScenarios?: FixtureScenarioConfig['operations']
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
  env: AdminEnv,
  options: AdminDataClientOptions = {}
): AdminDataClient {
  if (!isParsedAdminEnv(env)) {
    throw new AdminDataSourceConfigurationError(
      'INVALID_DATA_SOURCE',
      'Admin data source requires parseAdminEnv output'
    )
  }
  const dataSource = env.ADMIN_DATA_SOURCE

  if (dataSource === 'fixture') {
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
      throw new AdminDataSourceConfigurationError(
        'FIXTURE_NOT_ALLOWED',
        'ADMIN_DATA_SOURCE=fixture is only allowed when NODE_ENV is development or test'
      )
    }

    const fixture = createFixtureAdminDataClient()
    return options.fixtureScenarios
      ? createScenarioFixtureAdminDataClient(
          env,
          options.fixtureScenarios,
          fixture
        )
      : fixture
  }

  throw new AdminDataSourceConfigurationError(
    'NOT_CONFIGURED',
    'Admin RPC data source is NOT_CONFIGURED'
  )
}
