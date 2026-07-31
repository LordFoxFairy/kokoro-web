import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"

import { LibraryView } from "../src/library-product"
import { isStudioQuoteActive, StudioView } from "../src/studio-product"

describe("Site media product views", () => {
  test("binds a quote to one input revision and its expiry", () => {
    const quote = { amount: "12", creditUnit: "credits", expiresAt: "2026-07-31T00:05:00.000Z", inputRevision: 4 }
    expect(isStudioQuoteActive(quote, 4, Date.parse("2026-07-31T00:04:59.000Z"))).toBe(true)
    expect(isStudioQuoteActive(quote, 5, Date.parse("2026-07-31T00:04:59.000Z"))).toBe(false)
    expect(isStudioQuoteActive(quote, 4, Date.parse("2026-07-31T00:05:00.000Z"))).toBe(false)
  })

  test("renders published Studio choices and the exact owner operation state", () => {
    const html = renderToStaticMarkup(<StudioView
      brandName="Fox Site"
      definitions={[{
        definitionKey: "image.text_to_image@v1",
        definitionRef: "image.text_to_image",
        definitionRevisionRef: "image.text_to_image@1",
        description: "Create an image",
        kind: "image_text_to_image",
        maximumCandidateCount: 4,
        modelOptionCatalogRevisionRef: "catalog@1",
        promptMaximumUtf8Bytes: 32768,
        publishedAt: "2026-07-31T00:00:00.000Z",
        supportedAspectRatios: ["square_1_1"],
        supportedOutputFormats: ["png"],
        title: "Image",
      }]}
      options={[{
        availability: "available",
        badges: ["Fast"],
        inputModalities: ["text"],
        label: "Image Safe",
        modelOptionRevisionRef: "image.safe@1",
        optionKey: "safe",
        outputModalities: ["image"],
        supportedEfforts: [],
      }]}
      operations={[{
        mediaOperationRef: "operation-1",
        definitionRef: "image.text_to_image",
        definitionRevisionRef: "image.text_to_image@1",
        ownerVersion: "2",
        progressBps: 5000,
        candidates: [],
        updatedAt: "2026-07-31T00:00:00.000Z",
        state: "active",
      }]}
      quote={{ amount: "12", creditUnit: "credits", expiresAt: "2099-07-31T00:05:00.000Z", inputRevision: 0 }}
      busy={false}
      error={null}
      onQuote={vi.fn()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      onRefresh={vi.fn()}
    />)
    expect(html).toContain("Fox Site Studio")
    expect(html).toContain("Image Safe")
    expect(html).toContain("50%")
    expect(html).toContain("12 credits")
  })

  test("renders delivery URLs only for ready versions and typed safe failures otherwise", () => {
    const common = {
      artifactRef: "artifact-1",
      artifactVersionRef: "artifact-v1",
      ownerVersion: "1",
      versionNumber: "1",
      mediaClass: "image" as const,
      sourceArtifactVersionRefs: [],
      createdAt: "2026-07-31T00:00:00.000Z",
    }
    const html = renderToStaticMarkup(<LibraryView
      brandName="Fox Site"
      artifacts={[]}
      versions={[
        { ...common, availability: "ready", display: { format: "png", width: 512, height: 512, byteSize: "4" }, contentUrl: "/api/media/artifacts/artifact-1/versions/artifact-v1/content?purpose=preview&amp;viewport=thumbnail" },
        { ...common, artifactVersionRef: "artifact-v2", availability: "restricted", safeFailure: { code: "artifact_restricted", retryClass: "never", safeMessage: "Restricted by policy." } },
      ]}
      busy={false}
      error={null}
      onSelectArtifact={vi.fn()}
      onRefresh={vi.fn()}
    />)
    expect(html).toContain("/api/media/artifacts/artifact-1/versions/artifact-v1/content")
    expect(html).toContain("Restricted by policy.")
    expect(html).not.toContain("artifact-v2/content")
  })
})
