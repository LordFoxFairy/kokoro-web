import { z } from 'zod'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { projectPageProps, type PageProps } from './page-props'
import type { PageError, PageState } from './page-state'

const dataSchema = z
  .object({
    id: z.string(),
    nested: z.object({ active: z.boolean() }).strict(),
    nextPageToken: z.string().optional(),
  })
  .strict()

const error: PageError = {
  code: 'UNAVAILABLE',
  businessCode: 'IAM_TEMPORARILY_UNAVAILABLE',
  fieldViolations: [{ path: 'displayName', code: 'REQUIRED' }],
  requestId: 'req_page_props',
  retryable: true,
  retryAfterMs: 750,
}

function terminalError<Code extends PageError['code']>(
  code: Code
): PageError<Code> {
  return { ...error, code }
}

describe('projectPageProps', () => {
  it('preserves every page-state semantic with readonly JSON data', () => {
    const data = {
      id: 'user_1',
      nested: { active: true },
      nextPageToken: 'opaque_page_cursor',
    }
    const states: readonly PageState<typeof data>[] = [
      { status: 'loading' },
      { status: 'ready', data },
      { status: 'empty' },
      { status: 'error', error },
      {
        status: 'unauthenticated',
        error: terminalError('UNAUTHENTICATED'),
      },
      { status: 'forbidden', error: terminalError('PERMISSION_DENIED') },
      { status: 'not-found', error: terminalError('NOT_FOUND') },
      { status: 'partial', data, error },
    ]

    const projected = states.map((state) => projectPageProps(state, dataSchema))

    expect(projected).toEqual(states)
    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected)
    expect(Object.isFrozen(projected[1])).toBe(true)
    if (projected[1]?.status !== 'ready') throw new Error('expected ready')
    expect(Object.isFrozen(projected[1].data)).toBe(true)
    expect(Object.isFrozen(projected[1].data.nested)).toBe(true)
    expectTypeOf(projectPageProps(states[1]!, dataSchema)).toEqualTypeOf<
      PageProps<z.output<typeof dataSchema>>
    >()
  })

  it('uses the schema as an exact server-to-client contract', () => {
    expect(() =>
      projectPageProps(
        {
          status: 'ready',
          data: { id: 'user_1', nested: { active: 'yes' } },
        } as unknown as PageState<unknown>,
        dataSchema
      )
    ).toThrowError('Invalid page data')
  })

  it.each([
    ['function', () => undefined],
    ['symbol', Symbol('value')],
    ['bigint', BigInt(1)],
    ['undefined', undefined],
    ['non-finite number', Number.POSITIVE_INFINITY],
  ])('rejects %s values before crossing the boundary', (_name, value) => {
    expect(() =>
      projectPageProps(
        { status: 'ready', data: value } as PageState<unknown>,
        z.unknown()
      )
    ).toThrowError('Page state is not safe for client props')
  })

  it('rejects AbortSignal and class instances', () => {
    class Client {
      readonly endpoint = '/rpc'
    }

    for (const value of [new AbortController().signal, new Client()]) {
      expect(() =>
        projectPageProps({ status: 'ready', data: value }, z.unknown())
      ).toThrowError('Page state is not safe for client props')
    }
  })

  it('rejects cycles, symbols, accessors, sparse arrays and unsafe prototypes', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const withSymbol = { value: 'ok', [Symbol('hidden')]: 'secret' }
    const withGetter = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 'do not invoke',
    })
    const sparse = Array(2)
    sparse[1] = 'value'
    const inherited = Object.create({ inherited: true }) as Record<
      string,
      unknown
    >
    inherited.value = 'own'

    for (const value of [cyclic, withSymbol, withGetter, sparse, inherited]) {
      expect(() =>
        projectPageProps({ status: 'ready', data: value }, z.unknown())
      ).toThrowError('Page state is not safe for client props')
    }
  })

  it.each([
    '__proto__',
    'prototype',
    'constructor',
    'password',
    'authorization',
    'token',
    'credentialValue',
    'cookieHeader',
    'accessToken',
    'refresh_token',
    'session-token',
    'apiKey',
    'privateKey',
    'clientSecret',
    'setCookie',
  ])('rejects unsafe field %s at any depth', (field) => {
    const value = JSON.parse(`{"safe":{"${field}":"hidden"}}`) as unknown
    expect(() =>
      projectPageProps({ status: 'ready', data: value }, z.unknown())
    ).toThrowError('Page state is not safe for client props')
  })

  it.each([
    'tokenCount',
    'accessTokenUsage',
    'cookieConsent',
    'credentialType',
    'secretaryId',
  ])('keeps non-secret operational field %s', (field) => {
    expect(
      projectPageProps(
        { status: 'ready', data: { [field]: 'visible' } },
        z.record(z.string(), z.string())
      )
    ).toEqual({ status: 'ready', data: { [field]: 'visible' } })
  })

  it('does not expose backend presentation text from error states', () => {
    const unsafeError = {
      ...error,
      message: 'private backend detail',
      safeMessage: 'backend-owned presentation text',
      cause: 'transport stack',
      stack: 'private stack',
    }
    const projected = projectPageProps(
      { status: 'error', error: unsafeError },
      dataSchema
    )

    expect(projected).toEqual({ status: 'error', error })
    expect(JSON.stringify(projected)).not.toContain('backend')
    expect(JSON.stringify(projected)).not.toContain('transport')
    expect(JSON.stringify(projected)).not.toContain('stack')
  })

  it.each([
    ['unauthenticated', 'PERMISSION_DENIED'],
    ['forbidden', 'UNAUTHENTICATED'],
    ['not-found', 'UNKNOWN'],
  ] as const)('fails closed when %s conflicts with %s', (status, code) => {
    const conflicting = {
      status,
      error: terminalError(code),
    } as unknown as PageState<unknown>

    expect(() => projectPageProps(conflicting, z.unknown())).toThrowError(
      'Page state is not safe for client props'
    )
  })

  it('associates terminal statuses with their canonical error codes', () => {
    expectTypeOf<
      Extract<PageState<never>, { status: 'unauthenticated' }>['error']['code']
    >().toEqualTypeOf<'UNAUTHENTICATED'>()
    expectTypeOf<
      Extract<PageState<never>, { status: 'forbidden' }>['error']['code']
    >().toEqualTypeOf<'PERMISSION_DENIED'>()
    expectTypeOf<
      Extract<PageState<never>, { status: 'not-found' }>['error']['code']
    >().toEqualTypeOf<'NOT_FOUND'>()
  })

  it('rejects schema transforms that introduce unsafe output', () => {
    const schema = z.string().transform(() => ({ run: () => undefined }))

    expect(() =>
      projectPageProps({ status: 'ready', data: 'safe input' }, schema)
    ).toThrowError('Page data schema produced unsafe client props')
  })
})
