import { describe, expect, it } from 'vitest'
import { resolveSafeAdminCallbackUrl, resolveSafeCallbackUrl } from './redirect'

const APP_ORIGIN = 'https://admin.kokoro.test:8443'

describe('resolveSafeCallbackUrl', () => {
  it.each([
    ['/users', '/users'],
    ['/users?page=2#details', '/users?page=2#details'],
    [
      'https://admin.kokoro.test:8443/audit?actor=me#event',
      '/audit?actor=me#event',
    ],
    ['https://admin.kokoro.test:8443', '/'],
  ])('returns the same-origin path for %s', (callbackUrl, expected) => {
    expect(resolveSafeCallbackUrl(callbackUrl, APP_ORIGIN)).toBe(expected)
  })

  it.each([
    undefined,
    null,
    '',
    ' users',
    '/users ',
    'users',
    '//evil.test/phish',
    '///evil.test/phish',
    String.raw`\\evil.test\phish`,
    String.raw`/\evil.test/phish`,
    'https://evil.test/phish',
    'https://admin.kokoro.test/phish',
    'https://admin.kokoro.test:9443/phish',
    'https://admin.kokoro.test.evil.test/phish',
    'http://admin.kokoro.test:8443/phish',
    'https://user@admin.kokoro.test:8443/phish',
    'https://user:secret@admin.kokoro.test:8443/phish',
    'javascript:alert(1)',
    'data:text/html,phish',
    'file:///etc/passwd',
    'https://%',
    '\u0000https://admin.kokoro.test:8443/users',
    '/users\u0000/settings',
  ])('falls back for an unsafe callback URL: %s', (callbackUrl) => {
    expect(resolveSafeCallbackUrl(callbackUrl, APP_ORIGIN)).toBe('/')
  })

  it.each([
    'not a URL',
    'ftp://admin.kokoro.test',
    'https://user:secret@admin.kokoro.test',
  ])('falls back when the application origin is invalid: %s', (appOrigin) => {
    expect(resolveSafeCallbackUrl('/users', appOrigin)).toBe('/')
  })

  it('never includes the application origin in its output', () => {
    const result = resolveSafeCallbackUrl(
      'https://admin.kokoro.test:8443/sessions?status=active#current',
      APP_ORIGIN
    )

    expect(result).toBe('/sessions?status=active#current')
    expect(result).not.toContain('admin.kokoro.test')
  })
})

describe('resolveSafeAdminCallbackUrl', () => {
  it.each([
    ['/users?page=2#results', '/users?page=2#results'],
    ['/users/usr_ada', '/users/usr_ada'],
    ['/forbidden', '/forbidden'],
    ['https://admin.kokoro.test:8443/audit', '/audit'],
  ])('allows a registered Admin route: %s', (callbackUrl, expected) => {
    expect(resolveSafeAdminCallbackUrl(callbackUrl, APP_ORIGIN)).toBe(expected)
  })

  it.each([
    '/login',
    '/api/auth/callback/credentials',
    '/_next/static/chunk.js',
    '/unknown',
    '/users/usr_ada/extra',
    'https://evil.test/users',
  ])('falls back for a non-Admin callback route: %s', (callbackUrl) => {
    expect(resolveSafeAdminCallbackUrl(callbackUrl, APP_ORIGIN)).toBe('/')
  })
})
