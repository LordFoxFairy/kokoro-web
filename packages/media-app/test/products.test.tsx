import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"

import { LibraryView } from "../src/library-product"
import {
  createStudioOperationInput,
  isStudioQuoteActive,
  reconcileStudioDraft,
  StudioView,
} from "../src/studio-product"

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
      submissionBlocked={false}
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

  test("constructs Studio input only within the published integer candidate range", () => {
    const definition = {
      definitionKey: "image.text_to_image@v1" as const,
      definitionRef: "image.text_to_image" as const,
      definitionRevisionRef: "image.text_to_image@1",
      description: "Create an image",
      kind: "image_text_to_image" as const,
      maximumCandidateCount: 2,
      modelOptionCatalogRevisionRef: "catalog@1",
      promptMaximumUtf8Bytes: 32768 as const,
      publishedAt: "2026-07-31T00:00:00.000Z",
      supportedAspectRatios: ["square_1_1" as const],
      supportedOutputFormats: ["png" as const],
      title: "Image",
    }
    const base = {
      definition,
      options: [{
        availability: "available" as const,
        badges: [],
        inputModalities: ["text" as const],
        label: "Image Safe",
        modelOptionRevisionRef: "image.safe@1",
        optionKey: "safe",
        outputModalities: ["image" as const],
        supportedEfforts: [],
      }],
      optionRef: "image.safe@1",
      prompt: "A fox beneath the moon",
      aspectRatio: "square_1_1" as const,
      outputFormat: "png" as const,
    }

    expect(createStudioOperationInput({ ...base, candidateCount: 1 })).toEqual(expect.objectContaining({ candidateCount: 1 }))
    expect(createStudioOperationInput({ ...base, candidateCount: 1.5 })).toBeNull()
    expect(createStudioOperationInput({ ...base, candidateCount: 0 })).toBeNull()
    expect(createStudioOperationInput({ ...base, candidateCount: 3 })).toBeNull()
    expect(createStudioOperationInput({ ...base, candidateCount: 1, prompt: "bad\ud800text" })).toBeNull()
  })

  test("disables creation while a prior submit command still needs reconciliation", () => {
    const html = renderToStaticMarkup(<StudioView
      brandName="Fox Site"
      definitions={[]}
      options={[]}
      operations={[]}
      quote={null}
      busy={false}
      submissionBlocked
      error={null}
      onQuote={vi.fn()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      onRefresh={vi.fn()}
    />)
    expect(html).toContain("Recovering a previous creation")
  })

  test("atomically reconciles all revision-bound controls when the publication changes", () => {
    const next = reconcileStudioDraft({
      definitionRevisionRef: "image.text_to_image@1",
      modelOptionCatalogRevisionRef: "catalog@1",
      prompt: "A fox",
      optionRef: "removed@1",
      aspectRatio: "landscape_16_9",
      outputFormat: "jpeg",
      candidateCount: 4,
      inputRevision: 7,
    }, {
      definitionKey: "image.text_to_image@v1",
      definitionRef: "image.text_to_image",
      definitionRevisionRef: "image.text_to_image@2",
      description: "Create an image",
      kind: "image_text_to_image",
      maximumCandidateCount: 2,
      modelOptionCatalogRevisionRef: "catalog@2",
      promptMaximumUtf8Bytes: 32768,
      publishedAt: "2026-07-31T00:00:00.000Z",
      supportedAspectRatios: ["portrait_9_16"],
      supportedOutputFormats: ["webp"],
      title: "Image",
    }, [{
      availability: "available",
      badges: [],
      inputModalities: ["text"],
      label: "Replacement",
      modelOptionRevisionRef: "replacement@2",
      optionKey: "replacement",
      outputModalities: ["image"],
      supportedEfforts: [],
    }])

    expect(next).toEqual({
      definitionRevisionRef: "image.text_to_image@2",
      modelOptionCatalogRevisionRef: "catalog@2",
      prompt: "A fox",
      optionRef: "replacement@2",
      aspectRatio: "portrait_9_16",
      outputFormat: "webp",
      candidateCount: 2,
      inputRevision: 8,
    })
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
      artifacts={[{
        artifactRef: "artifact-1",
        availability: "ready",
        currentArtifactVersionRef: "artifact-v1",
        mediaClass: "image",
        title: "Moon fox",
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:00.000Z",
        contentUrl: "/api/media/artifacts/artifact-1/versions/artifact-v1/content?purpose=preview&viewport=thumbnail",
      }]}
      selectedArtifactRef="artifact-1"
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
    expect(html).toContain("Loading preview")
    expect(html).toContain("aria-current=\"true\"")
    expect(html).toContain("Restricted by policy.")
    expect(html).not.toContain("artifact-v2/content")
  })

  test("renders typed partial, reconciling, candidate and irreconcilable copy", () => {
    const html = renderToStaticMarkup(<StudioView
      brandName="Fox Site"
      definitions={[]}
      options={[]}
      operations={[
        {
          mediaOperationRef: "operation-partial",
          definitionRef: "image.text_to_image",
          definitionRevisionRef: "image.text_to_image@1",
          ownerVersion: "5",
          progressBps: 10_000,
          candidates: [
            { candidateRef: "candidate-ready", ordinal: 0, ownerVersion: "3", state: "ready", artifactRef: "artifact-1", artifactVersionRef: "artifact-v1" },
            { candidateRef: "candidate-restricted", ordinal: 1, ownerVersion: "3", state: "restricted", failure: { code: "artifact_restricted", retryClass: "never", safeMessage: "Restricted by policy." } },
          ],
          updatedAt: "2026-07-31T00:00:00.000Z",
          state: "partial",
          outcomeClass: "canonical",
        },
        {
          mediaOperationRef: "operation-reconciling",
          definitionRef: "image.text_to_image",
          definitionRevisionRef: "image.text_to_image@1",
          ownerVersion: "2",
          progressBps: 5400,
          candidates: [{ candidateRef: "candidate-unknown", ordinal: 0, ownerVersion: "2", state: "unknown" }],
          updatedAt: "2026-07-31T00:00:00.000Z",
          state: "reconciling",
        },
        {
          mediaOperationRef: "operation-canceled",
          definitionRef: "image.text_to_image",
          definitionRevisionRef: "image.text_to_image@1",
          ownerVersion: "8",
          progressBps: 7000,
          candidates: [{ candidateRef: "candidate-canceled", ordinal: 0, ownerVersion: "5", state: "canceled" }],
          updatedAt: "2026-07-31T00:00:00.000Z",
          state: "canceled",
          outcomeClass: "irreconcilable",
        },
      ]}
      quote={null}
      busy={false}
      submissionBlocked={false}
      error={null}
      onQuote={vi.fn()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      onRefresh={vi.fn()}
    />)

    expect(html).toContain("Some outputs are ready")
    expect(html).toContain("Owner is reconciling an uncertain outcome")
    expect(html).toContain("Outcome could not be fully confirmed")
    expect(html).toContain("Ready in Library")
    expect(html).toContain("Restricted by policy.")
    expect(html).toContain("role=\"progressbar\"")
  })

  test("merges artifact versions monotonically and polls only while owner work is processing", async () => {
    const module = await import("../src/library-product") as unknown as Readonly<Record<string, unknown>>
    const merge = module.mergeBrowserArtifactVersions as undefined | ((
      current: readonly Record<string, unknown>[],
      incoming: readonly Record<string, unknown>[],
    ) => Readonly<{ versions: readonly Record<string, unknown>[]; madeProgress: boolean }>)
    const shouldPoll = module.shouldPollArtifactVersions as undefined | ((
      selectedArtifactRef: string | null,
      versions: readonly Record<string, unknown>[],
    ) => boolean)
    expect(typeof merge).toBe("function")
    expect(typeof shouldPoll).toBe("function")
    if (merge === undefined || shouldPoll === undefined) return
    const common = {
      artifactRef: "artifact-1",
      artifactVersionRef: "artifact-v1",
      versionNumber: "1",
      mediaClass: "image",
      sourceArtifactVersionRefs: [],
      createdAt: "2026-07-31T00:00:00.000Z",
    }
    const newer = { ...common, ownerVersion: "2", availability: "processing" }
    const stale = { ...common, ownerVersion: "1", availability: "processing" }
    expect(merge([newer], [stale])).toEqual({ versions: [newer], madeProgress: false })
    expect(shouldPoll("artifact-1", [newer])).toBe(true)
    const ready = { ...common, ownerVersion: "3", availability: "ready", display: { format: "png", width: 32, height: 32, byteSize: "4" }, contentUrl: "/api/media/artifacts/artifact-1/versions/artifact-v1/content?purpose=preview&viewport=thumbnail" }
    expect(merge([newer], [ready])).toEqual({ versions: [ready], madeProgress: true })
    expect(shouldPoll("artifact-1", [ready])).toBe(false)
    expect(shouldPoll(null, [newer])).toBe(false)
  })

  test("selects a Studio deep link only after the Artifact appears in the owner list", async () => {
    const module = await import("../src/library-product") as unknown as Readonly<Record<string, unknown>>
    const resolve = module.resolveInitialArtifactRef as undefined | ((
      requested: string | null | undefined,
      artifacts: readonly Readonly<{ artifactRef: string }>[],
    ) => string | null)
    expect(typeof resolve).toBe("function")
    if (resolve === undefined) return
    const artifacts = [{ artifactRef: "artifact-1" }]
    expect(resolve("artifact-1", artifacts)).toBe("artifact-1")
    expect(resolve("artifact-other", artifacts)).toBeNull()
    expect(resolve(undefined, artifacts)).toBeNull()
  })
})
