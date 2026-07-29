function credentialIsActive(expiresAt: string, now: number): boolean {
  const expiry = Date.parse(expiresAt)
  return Number.isFinite(expiry) && expiry > now
}

export function sessionCredentialIsActive(expiresAt: string, now = Date.now()): boolean {
  return credentialIsActive(expiresAt, now)
}

export function refreshCredentialIsActive(expiresAt: string, now = Date.now()): boolean {
  return credentialIsActive(expiresAt, now)
}

/** Reassemble Auth.js' numbered cookie chunks and reject shadowed or sparse sets. */
export function assembleChunkedCookie(
  entries: readonly Readonly<{ name: string; value: string }>[],
  name: string,
  maximumBytes = 32_768,
): string | null {
  const exact = entries.filter((entry) => entry.name === name)
  const prefix = `${name}.`
  const chunks = entries.flatMap((entry) => {
    if (!entry.name.startsWith(prefix)) return []
    const suffix = entry.name.slice(prefix.length)
    if (!/^\d+$/u.test(suffix)) return [{ index: -1, value: entry.value }]
    return [{ index: Number(suffix), value: entry.value }]
  })
  if (exact.length > 1 || (exact.length === 1 && chunks.length > 0)) return null
  if (exact.length === 1) {
    const value = exact[0]!.value
    return value.length > 0 && value.length <= maximumBytes ? value : null
  }
  if (chunks.length === 0 || chunks.length > 16) return null
  chunks.sort((left, right) => left.index - right.index)
  if (chunks.some((chunk, index) => chunk.index !== index)) return null
  const value = chunks.map((chunk) => chunk.value).join("")
  return value.length > 0 && value.length <= maximumBytes ? value : null
}
