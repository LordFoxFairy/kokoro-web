import { describe, expect, it } from "vitest"

import {
  parseSiteLegalDocuments,
  publicLegalDocuments,
} from "../src/site-legal-documents.js"

describe("Site legal-document registry", () => {
  it("creates the browser projection from one typed deployment registry", () => {
    const documents = parseSiteLegalDocuments(JSON.stringify([
      { termRef: "terms-2026", label: "Terms of Service", href: "/terms" },
      { termRef: "privacy-2026", label: "Privacy Policy", href: "https://legal.example/privacy" },
    ]))

    expect(documents).toEqual([
      { termRef: "terms-2026", label: "Terms of Service", href: "/terms" },
      { termRef: "privacy-2026", label: "Privacy Policy", href: "https://legal.example/privacy" },
    ])
    expect(publicLegalDocuments(documents)).toEqual([
      { label: "Terms of Service", href: "/terms" },
      { label: "Privacy Policy", href: "https://legal.example/privacy" },
    ])
  })

  it.each([
    [{ termRef: "terms", label: "Terms", href: "javascript:alert(1)" }],
    [{ termRef: "terms", label: "Terms", href: "//evil.example/terms" }],
    [{ termRef: "terms", label: "Terms", href: "/safe\nunsafe" }],
    [{ termRef: "terms", label: "Terms", href: "/terms", extra: true }],
    [
      { termRef: "terms", label: "Terms", href: "/terms" },
      { termRef: "terms", label: "Other terms", href: "/terms-v2" },
    ],
  ])("fails the entire registry closed for an unsafe or ambiguous entry", (value) => {
    expect(parseSiteLegalDocuments(JSON.stringify(value))).toEqual([])
  })
})
