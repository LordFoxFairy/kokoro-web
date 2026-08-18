import { describe, expect, it } from 'vitest'
import {
  formatAuditOutcome,
  formatCount,
  formatEntityStatus,
  formatInstantDate,
  formatInstantDateTime,
  formatRelativeInstant,
  formatStableId,
  formatSessionStatus,
} from './format'

const display = { locale: 'en-US', timeZone: 'UTC' } as const

describe('instant formatting', () => {
  it('formats dates and date-times with an explicit locale and time zone', () => {
    const instant = '2026-08-18T14:35:42.000Z'

    expect(formatInstantDate(instant, display)).toBe('Aug 18, 2026')
    expect(formatInstantDateTime(instant, display)).toBe(
      'Aug 18, 2026, 2:35 PM'
    )
    expect(
      formatInstantDateTime(instant, {
        locale: 'en-US',
        timeZone: 'America/New_York',
      })
    ).toBe('Aug 18, 2026, 10:35 AM')
  })

  it.each([
    '',
    'not-an-instant',
    '2026-13-40T25:00:00Z',
    '2026-02-29T00:00:00Z',
    '2024-02-30T00:00:00Z',
  ])('rejects invalid ISO instant %j', (instant) => {
    expect(() => formatInstantDate(instant, display)).toThrow(
      'Invalid ISO instant'
    )
  })

  it('accepts February 29 in a leap year', () => {
    expect(formatInstantDate('2024-02-29T00:00:00Z', display)).toBe(
      'Feb 29, 2024'
    )
  })
})

describe('relative instant formatting', () => {
  const now = '2026-08-18T14:35:42.000Z'

  it.each([
    ['2026-08-18T14:35:42.000Z', 'now'],
    ['2026-08-18T14:35:12.000Z', '30 seconds ago'],
    ['2026-08-18T14:33:42.000Z', '2 minutes ago'],
    ['2026-08-18T12:35:42.000Z', '2 hours ago'],
    ['2026-08-16T14:35:42.000Z', '2 days ago'],
    ['2026-08-18T14:36:42.000Z', 'in 1 minute'],
  ])('formats %s relative to an injected now', (instant, expected) => {
    expect(formatRelativeInstant(instant, { locale: 'en-US', now })).toBe(
      expected
    )
  })

  it('rejects an invalid injected now', () => {
    expect(() =>
      formatRelativeInstant('2026-08-18T14:35:42.000Z', {
        locale: 'en-US',
        now: 'invalid',
      })
    ).toThrow('Invalid ISO instant')
  })
})

describe('count and identifier formatting', () => {
  it('formats non-negative integer counts with an explicit locale', () => {
    expect(formatCount(1234567, { locale: 'en-US' })).toBe('1,234,567')
    expect(formatCount(0, { locale: 'en-US' })).toBe('0')
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid count %s',
    (count) => {
      expect(() => formatCount(count, { locale: 'en-US' })).toThrow(
        'Count must be a non-negative integer'
      )
    }
  )

  it('keeps short IDs and abbreviates long IDs deterministically', () => {
    expect(formatStableId('site_42')).toBe('site_42')
    expect(formatStableId('00000000-0000-4000-8000-000000000001')).toBe(
      '00000000…0001'
    )
  })

  it('rejects empty IDs', () => {
    expect(() => formatStableId('   ')).toThrow('ID must not be empty')
  })
})

describe('status labels', () => {
  it('maps every entity status explicitly', () => {
    expect(
      (['active', 'suspended', 'deleted', 'unknown'] as const).map(
        formatEntityStatus
      )
    ).toEqual(['Active', 'Suspended', 'Deleted', 'Unknown'])
  })

  it('maps every session status explicitly', () => {
    expect(
      (['active', 'expired', 'revoked', 'unknown'] as const).map(
        formatSessionStatus
      )
    ).toEqual(['Active', 'Expired', 'Revoked', 'Unknown'])
  })

  it('maps every audit outcome explicitly', () => {
    expect(
      (['success', 'denied', 'failure', 'unknown'] as const).map(
        formatAuditOutcome
      )
    ).toEqual(['Success', 'Denied', 'Failure', 'Unknown'])
  })

  it.each([
    [formatEntityStatus, 'pending'],
    [formatSessionStatus, 'disabled'],
    [formatAuditOutcome, 'warning'],
  ] as const)('rejects values outside the contract', (formatter, value) => {
    expect(() => formatter(value as never)).toThrow('Unsupported')
  })
})
