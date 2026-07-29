export type SiteLegalDocument = Readonly<{
  termRef: string
  label: string
  href: string
}>

export type PublicLegalDocument = Readonly<{ label: string; href: string }>

function safeHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) return null
  if (Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 0x20 || codePoint === 0x7f
  })) return null
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" ? parsed.href : null
  } catch {
    return null
  }
}

/** The deployment projection of the SiteRelease legal-document registry. Invalid input fails closed. */
export function parseSiteLegalDocuments(raw: string | undefined): readonly SiteLegalDocument[] {
  if (raw === undefined || raw.trim() === "") return Object.freeze([])
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value) || value.length < 1 || value.length > 16) return Object.freeze([])
    const documents = value.map((candidate): SiteLegalDocument | null => {
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return null
      const entry = candidate as Readonly<Record<string, unknown>>
      if (Object.keys(entry).some((key) => !["termRef", "label", "href"].includes(key))) return null
      const termRef = typeof entry.termRef === "string" ? entry.termRef.trim() : ""
      const label = typeof entry.label === "string" ? entry.label.trim() : ""
      const href = safeHref(entry.href)
      return termRef.length > 0 && termRef.length <= 128 && label.length > 0 && label.length <= 128 && href !== null
        ? Object.freeze({ termRef, label, href })
        : null
    })
    if (!documents.every((document) => document !== null)) return Object.freeze([])
    const safe = documents as SiteLegalDocument[]
    if (new Set(safe.map(({ termRef }) => termRef)).size !== safe.length) return Object.freeze([])
    if (new Set(safe.map(({ href }) => href)).size !== safe.length) return Object.freeze([])
    return Object.freeze(safe)
  } catch {
    return Object.freeze([])
  }
}

export function publicLegalDocuments(documents: readonly SiteLegalDocument[]): readonly PublicLegalDocument[] {
  return Object.freeze(documents.map(({ label, href }) => Object.freeze({ label, href })))
}
