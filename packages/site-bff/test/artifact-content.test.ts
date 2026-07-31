import { describe, expect, test, vi } from "vitest"

import type { ArtifactDeliveryTransport, PlatformPublicOperationId } from "@kokoro/site-client/server"

import { createSiteMediaAuthority, SiteArtifactAvailabilityError } from "../src/media-authority.js"

const readyVersion = {
  artifactRef: "artifact-1",
  artifactVersionRef: "artifact-version-1",
  ownerVersion: "9",
  versionNumber: "1",
  mediaClass: "image",
  sourceArtifactVersionRefs: [],
  createdAt: "2026-07-31T00:00:00.000Z",
  availability: "ready",
  display: { format: "png", width: 1024, height: 1024, byteSize: "4" },
} as const

describe("Site media artifact authority", () => {
  test("checks the exact ready owner version then issues and immediately redeems a server-only capability", async () => {
    const operations: PlatformPublicOperationId[] = []
    const execute = vi.fn((input: { operationId: PlatformPublicOperationId }) => {
      operations.push(input.operationId)
      if (input.operationId === "getArtifactVersion") return Promise.resolve({ version: readyVersion })
      if (input.operationId === "issueArtifactDeliveryAuthorization") return Promise.resolve({ authorization: {
        artifactRef: "artifact-1",
        artifactVersionRef: "artifact-version-1",
        audience: "site-bff.artifact-delivery",
        authorizationRef: "authorization-1",
        deliveryCapability: "d".repeat(64),
        expiresAt: "2026-07-31T00:05:00.000Z",
        issuedAt: "2026-07-31T00:00:00.000Z",
        purpose: "preview",
      } })
      throw new Error("unexpected operation")
    })
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Uint8Array.of(1, 2, 3, 4)); controller.close() },
    })
    const redeem = vi.fn<ArtifactDeliveryTransport["redeem"]>(() => Promise.resolve({
      status: 200,
      headers: new Headers({ "content-type": "image/png", "content-length": "4" }),
      body,
    }))
    const media = createSiteMediaAuthority({
      projectRef: "server-project",
      platform: { execute } as never,
      deliveryTransport: { redeem },
    })

    const response = await media.artifactContent(
      "artifact-1",
      "artifact-version-1",
      { purpose: "preview", viewportClass: "thumbnail" },
      { signal: new AbortController().signal, deadlineMs: 5_000 },
    )

    expect(operations).toEqual(["getArtifactVersion", "issueArtifactDeliveryAuthorization"])
    expect(redeem).toHaveBeenCalledWith(expect.objectContaining({
      path: "/v1/artifact-delivery-authorizations/authorization-1/content",
      security: { deliveryCapability: "d".repeat(64) },
    }))
    expect(response.body).not.toBe(body)
    expect((await response.body.getReader().read()).value).toEqual(Uint8Array.of(1, 2, 3, 4))
    expect(JSON.stringify(response)).not.toContain("deliveryCapability")
  })

  test("returns typed non-ready availability without minting delivery authority", async () => {
    const execute = vi.fn(() => Promise.resolve({ version: {
      ...readyVersion,
      availability: "restricted",
      display: undefined,
      safeFailure: { code: "artifact_restricted", retryClass: "never", safeMessage: "Restricted by policy." },
    } }))
    const redeem = vi.fn<ArtifactDeliveryTransport["redeem"]>()
    const media = createSiteMediaAuthority({
      projectRef: "server-project",
      platform: { execute } as never,
      deliveryTransport: { redeem },
    })

    await expect(media.artifactContent(
      "artifact-1",
      "artifact-version-1",
      { purpose: "preview", viewportClass: "thumbnail" },
      { signal: new AbortController().signal, deadlineMs: 5_000 },
    )).rejects.toMatchObject({ availability: "restricted", failure: { code: "artifact_restricted" } })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(redeem).not.toHaveBeenCalled()
    expect(SiteArtifactAvailabilityError).toBeTypeOf("function")
  })
})
