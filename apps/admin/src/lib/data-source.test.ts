import { describe, expect, it } from 'vitest'
import {
  AdminDataSourceConfigurationError,
  createAdminDataClient,
} from './data-source'
import { parseAdminEnv, type AdminEnv } from './env'

function fixtureEnv(nodeEnv: 'development' | 'test') {
  return parseAdminEnv({
    NODE_ENV: nodeEnv,
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
    ADMIN_DATA_SOURCE: 'fixture',
  })
}

describe('createAdminDataClient', () => {
  it.each(['development', 'test'])(
    'creates a fixture client only when explicitly selected in %s',
    async (nodeEnv) => {
      const client = createAdminDataClient(
        fixtureEnv(nodeEnv as 'development' | 'test')
      )

      await expect(client.getCurrentIdentity()).resolves.toMatchObject({
        schemaVersion: 'kokoro.admin.fixture.v1',
      })
    }
  )

  it('reports the unimplemented RPC source as NOT_CONFIGURED', () => {
    const env = parseAdminEnv({
      NODE_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'https://admin.example.test',
      ADMIN_DATA_SOURCE: 'rpc',
      AUTH_SECRET: 'a-production-secret-with-32-characters',
      IAM_RPC_URL: 'https://iam.example.test',
    })
    expectConfigurationError(
      () => createAdminDataClient(env),
      'NOT_CONFIGURED',
      'Admin RPC data source is NOT_CONFIGURED'
    )
  })

  it('rejects a structurally valid but unbranded environment', () => {
    expectConfigurationError(
      () =>
        createAdminDataClient({
          NODE_ENV: 'development',
          NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
          ADMIN_DATA_SOURCE: 'fixture',
        } as AdminEnv),
      'INVALID_DATA_SOURCE',
      'Admin data source requires parseAdminEnv output'
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
