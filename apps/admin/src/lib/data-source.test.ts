import { describe, expect, it } from 'vitest'
import {
  AdminDataSourceConfigurationError,
  createAdminDataClient,
} from './data-source'

describe('createAdminDataClient', () => {
  it.each(['development', 'test'])(
    'creates a fixture client only when explicitly selected in %s',
    async (nodeEnv) => {
      const client = createAdminDataClient({
        ADMIN_DATA_SOURCE: 'fixture',
        NODE_ENV: nodeEnv,
      })

      await expect(client.getCurrentIdentity()).resolves.toMatchObject({
        schemaVersion: 'kokoro.admin.fixture.v1',
      })
    }
  )

  it.each([undefined, '', 'production', 'staging'])(
    'rejects fixture data when NODE_ENV is %s',
    (nodeEnv) => {
      expectConfigurationError(
        () =>
          createAdminDataClient({
            ADMIN_DATA_SOURCE: 'fixture',
            NODE_ENV: nodeEnv,
          }),
        'FIXTURE_NOT_ALLOWED',
        'ADMIN_DATA_SOURCE=fixture is only allowed when NODE_ENV is development or test'
      )
    }
  )

  it.each([undefined, '', 'rpc'])(
    'reports the unimplemented RPC source as NOT_CONFIGURED for %s',
    (dataSource) => {
      expectConfigurationError(
        () =>
          createAdminDataClient({
            ADMIN_DATA_SOURCE: dataSource,
            NODE_ENV: 'production',
          }),
        'NOT_CONFIGURED',
        'Admin RPC data source is NOT_CONFIGURED'
      )
    }
  )

  it('rejects unknown data sources without falling back to fixtures', () => {
    expectConfigurationError(
      () =>
        createAdminDataClient({
          ADMIN_DATA_SOURCE: 'preview',
          NODE_ENV: 'development',
        }),
      'INVALID_DATA_SOURCE',
      'Unsupported ADMIN_DATA_SOURCE: preview'
    )
  })
})

function expectConfigurationError(
  action: () => unknown,
  code: AdminDataSourceConfigurationError['code'],
  message: string
) {
  try {
    action()
    throw new Error('Expected data source selection to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(AdminDataSourceConfigurationError)
    expect(error).toMatchObject({ code, message })
  }
}
