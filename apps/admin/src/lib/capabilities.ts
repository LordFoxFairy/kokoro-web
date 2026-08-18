export type Capability = string

/** Capability codes stay opaque and come from the versioned IAM contract. */
export interface CapabilityRule {
  readonly allOf?: readonly Capability[]
  readonly anyOf?: readonly Capability[]
}

function readDenseStringArray(value: unknown): readonly string[] | null {
  try {
    if (!Array.isArray(value)) return null
    const result: string[] = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index)
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'string' ||
        descriptor.value.length === 0
      ) {
        return null
      }
      result.push(descriptor.value)
    }
    return result
  } catch {
    return null
  }
}

function readRuleArray(
  rule: unknown,
  field: keyof CapabilityRule
): readonly string[] | undefined | null {
  try {
    if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
      return null
    }
    const descriptor = Object.getOwnPropertyDescriptor(rule, field)
    if (descriptor === undefined) return undefined
    if (!('value' in descriptor)) return null
    return readDenseStringArray(descriptor.value)
  } catch {
    return null
  }
}

/**
 * Evaluates a UI capability rule without inferring roles, hierarchy, or
 * backend authorization. Empty rules fail closed.
 */
export function matchesCapabilityRule(
  capabilities: readonly Capability[],
  rule: CapabilityRule
): boolean {
  const grantedCapabilities = readDenseStringArray(capabilities)
  const allOfValue = readRuleArray(rule, 'allOf')
  const anyOfValue = readRuleArray(rule, 'anyOf')
  if (
    grantedCapabilities === null ||
    allOfValue === null ||
    anyOfValue === null
  ) {
    return false
  }
  const allOf = allOfValue ?? []
  const anyOf = anyOfValue ?? []

  if (allOf.length === 0 && anyOf.length === 0) return false

  const granted = new Set(grantedCapabilities)

  return (
    allOf.every((capability) => granted.has(capability)) &&
    (anyOf.length === 0 || anyOf.some((capability) => granted.has(capability)))
  )
}
