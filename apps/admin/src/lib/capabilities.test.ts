import { describe, expect, it } from 'vitest'
import { matchesCapabilityRule, type CapabilityRule } from './capabilities'

describe('matchesCapabilityRule', () => {
  it('requires every opaque key in allOf', () => {
    const rule = { allOf: ['users.read', 'users.list'] }

    expect(matchesCapabilityRule(['users.read'], rule)).toBe(false)
    expect(matchesCapabilityRule(['users.read', 'users.list'], rule)).toBe(true)
  })

  it('requires at least one opaque key in anyOf', () => {
    const rule = { anyOf: ['users.disable', 'users.archive'] }

    expect(matchesCapabilityRule(['users.archive'], rule)).toBe(true)
    expect(matchesCapabilityRule(['users.read'], rule)).toBe(false)
  })

  it('requires allOf and anyOf when both are present', () => {
    const rule = {
      allOf: ['users.read'],
      anyOf: ['users.disable', 'users.archive'],
    }

    expect(matchesCapabilityRule(['users.read'], rule)).toBe(false)
    expect(matchesCapabilityRule(['users.archive'], rule)).toBe(false)
    expect(matchesCapabilityRule(['users.read', 'users.archive'], rule)).toBe(
      true
    )
  })

  it.each([{}, { allOf: [] }, { anyOf: [] }, { allOf: [], anyOf: [] }])(
    'fails closed for an empty rule: %o',
    (rule) => {
      expect(matchesCapabilityRule(['users.read'], rule)).toBe(false)
    }
  )

  it('treats keys as opaque and does not infer roles or capability closure', () => {
    expect(
      matchesCapabilityRule(['admin', 'users.*', 'users.read.detail'], {
        allOf: ['users.read'],
      })
    ).toBe(false)
  })

  it('does not mutate the granted capabilities or rule', () => {
    const capabilities = ['users.read', 'users.list'] as const
    const rule = { allOf: ['users.read', 'users.list'] } as const

    expect(matchesCapabilityRule(capabilities, rule)).toBe(true)
    expect(capabilities).toEqual(['users.read', 'users.list'])
    expect(rule).toEqual({ allOf: ['users.read', 'users.list'] })
  })

  it('fails closed for sparse, malformed and accessor-backed rules', () => {
    const sparse = Array<string>(1)
    let getterCalls = 0
    const accessorRule = Object.defineProperty({}, 'allOf', {
      get() {
        getterCalls += 1
        return ['users.read']
      },
    })

    expect(matchesCapabilityRule([], { allOf: sparse })).toBe(false)
    expect(matchesCapabilityRule(['users.read'], accessorRule)).toBe(false)
    expect(getterCalls).toBe(0)
    expect(
      matchesCapabilityRule(['users.read'], null as unknown as CapabilityRule)
    ).toBe(false)
  })

  it('fails closed for sparse or malformed granted capability lists', () => {
    expect(
      matchesCapabilityRule(Array<string>(1), { allOf: ['users.read'] })
    ).toBe(false)
    expect(
      matchesCapabilityRule([null as unknown as string], {
        allOf: ['users.read'],
      })
    ).toBe(false)
  })
})
