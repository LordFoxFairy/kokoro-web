import { describe, expect, test } from "vitest"

import type { ArtifactVersion, MediaOperationView } from "@kokoro/site-client"

import {
  projectPlatformArtifactOwnerState,
  projectPlatformMediaOperationOwnerState,
} from "../src/owner-projection"

const failure = {
  code: "artifact_restricted",
  retryClass: "never",
  safeMessage: "Restricted by policy.",
} as const

describe("Platform owner projections", () => {
  test("projects the closed media operation union into the shared owner model", () => {
    const input = {
      operationRef: "operation-1",
      definitionRef: "image.text_to_image",
      definitionRevisionRef: "image.text_to_image@1",
      modelOptionRevisionRef: "image.safe@1",
      ownerVersion: "7",
      progressBps: 10_000,
      candidates: [{
        candidateRef: "candidate-1",
        ordinal: 0,
        ownerVersion: "5",
        state: "ready",
        artifactRef: "artifact-1",
        artifactVersionRef: "artifact-version-1",
      }],
      costProjection: null,
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:01:00.000Z",
      state: "completed",
      outcomeClass: "canonical",
    } satisfies MediaOperationView

    expect(projectPlatformMediaOperationOwnerState(input)).toEqual({
      mediaOperationRef: "operation-1",
      definitionRef: "image.text_to_image",
      definitionRevisionRef: "image.text_to_image@1",
      modelOptionRevisionRef: "image.safe@1",
      ownerVersion: "7",
      progressBps: 10_000,
      candidates: [{
        candidateRef: "candidate-1",
        ordinal: 0,
        ownerVersion: "5",
        state: "ready",
        artifactRef: "artifact-1",
        artifactVersionRef: "artifact-version-1",
      }],
      updatedAt: "2026-07-31T00:01:00.000Z",
      state: "completed",
      outcomeClass: "canonical",
    })
  })

  test.each([
    ["duplicate candidate refs", [
      { candidateRef: "candidate-1", ordinal: 0, ownerVersion: "1", state: "producing" as const },
      { candidateRef: "candidate-1", ordinal: 1, ownerVersion: "1", state: "producing" as const },
    ]],
    ["non-canonical candidate order", [
      { candidateRef: "candidate-2", ordinal: 1, ownerVersion: "1", state: "producing" as const },
      { candidateRef: "candidate-1", ordinal: 0, ownerVersion: "1", state: "producing" as const },
    ]],
  ] as const)("rejects %s before creating browser owner state", (_name, candidates) => {
    expect(() => projectPlatformMediaOperationOwnerState({
      operationRef: "operation-1",
      definitionRef: "image.text_to_image",
      definitionRevisionRef: "image.text_to_image@1",
      modelOptionRevisionRef: "image.safe@1",
      ownerVersion: "1",
      progressBps: 100,
      candidates: [...candidates],
      costProjection: null,
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
      state: "active",
    })).toThrow(/candidate identity/u)
  })

  test.each([
    ["processing", {}],
    ["ready", { display: { format: "png", width: 1024, height: 1024, byteSize: "2048" } }],
    ["restricted", { safeFailure: failure }],
    ["unavailable", { safeFailure: { ...failure, code: "artifact_unavailable" } }],
    ["deleted", {}],
  ] as const)("projects typed artifact availability %s without inventing a URL", (availability, details) => {
    const input = {
      artifactRef: "artifact-1",
      artifactVersionRef: "artifact-version-1",
      ownerVersion: "9",
      versionNumber: "1",
      mediaClass: "image",
      sourceArtifactVersionRefs: [],
      createdAt: "2026-07-31T00:00:00.000Z",
      availability,
      ...details,
    } as ArtifactVersion

    const projected = projectPlatformArtifactOwnerState(input)
    expect(projected.availability).toBe(availability)
    expect(projected).not.toHaveProperty("updatedAt")
    expect(projected).not.toHaveProperty("url")
    if (projected.availability === "ready") {
      expect(projected.display).toEqual({
        kind: "image",
        format: "png",
        width: 1024,
        height: 1024,
        byteSize: "2048",
      })
    }
    if (projected.availability === "restricted" || projected.availability === "unavailable") {
      expect(projected.failure.safeMessage).toMatch(/policy|Restricted/u)
    }
  })
})
