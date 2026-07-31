import type {
  ArtifactOwnerState,
  CreditCostOwnerState,
  MediaCandidate,
  MediaFailure,
  MediaOperationOwnerState,
} from "@kokoro/chat-surface"
import { assertCanonicalMediaCandidateIdentity } from "@kokoro/chat-surface"
import type {
  ArtifactVersion,
  MediaCandidateView,
  MediaCostProjectionView,
  MediaOperationView,
  MediaSafeFailure,
} from "@kokoro/site-client"

function unreachable(value: never): never {
  throw new Error(`Unreachable Platform owner state: ${JSON.stringify(value)}`)
}

function failure(input: MediaSafeFailure): MediaFailure {
  return Object.freeze({
    code: input.code,
    retryClass: input.retryClass,
    safeMessage: input.safeMessage,
  })
}

function candidate(input: MediaCandidateView): MediaCandidate {
  const base = {
    candidateRef: input.candidateRef,
    ordinal: input.ordinal,
    ownerVersion: input.ownerVersion,
  }
  switch (input.state) {
    case "allocated":
    case "producing":
    case "output_received":
    case "validating":
    case "unknown":
    case "cancel_requested":
    case "canceled":
      return Object.freeze({ ...base, state: input.state })
    case "ready":
      return Object.freeze({
        ...base,
        state: input.state,
        artifactRef: input.artifactRef,
        artifactVersionRef: input.artifactVersionRef,
      })
    case "restricted":
    case "failed":
      return Object.freeze({ ...base, state: input.state, failure: failure(input.safeFailure) })
    default:
      return unreachable(input)
  }
}

export function projectPlatformMediaOperationOwnerState(
  input: MediaOperationView,
): MediaOperationOwnerState {
  assertCanonicalMediaCandidateIdentity(input.candidates)
  const base = {
    mediaOperationRef: input.operationRef,
    definitionRef: input.definitionRef,
    definitionRevisionRef: input.definitionRevisionRef,
    modelOptionRevisionRef: input.modelOptionRevisionRef,
    ownerVersion: input.ownerVersion,
    progressBps: input.progressBps,
    candidates: Object.freeze(input.candidates.map(candidate)),
    ...(input.costProjection === null ? {} : {
      costProjection: Object.freeze({
        costProjectionRef: input.costProjection.costProjectionRef,
        ownerVersion: input.costProjection.ownerVersion,
      }),
    }),
    updatedAt: input.updatedAt,
  }
  switch (input.state) {
    case "admission_pending":
    case "authorized":
    case "queued":
    case "active":
    case "finalizing":
    case "cancel_requested":
    case "reconciling":
      return Object.freeze({ ...base, state: input.state })
    case "completed":
    case "partial":
    case "canceled":
      return Object.freeze({ ...base, state: input.state, outcomeClass: input.outcomeClass })
    case "failed":
      return Object.freeze({
        ...base,
        state: input.state,
        outcomeClass: input.outcomeClass,
        failure: failure(input.safeFailure),
      })
    default:
      return unreachable(input)
  }
}

export function projectPlatformArtifactOwnerState(input: ArtifactVersion): ArtifactOwnerState {
  const base = {
    artifactRef: input.artifactRef,
    artifactVersionRef: input.artifactVersionRef,
    ownerVersion: input.ownerVersion,
    mediaClass: input.mediaClass,
  }
  switch (input.availability) {
    case "processing":
    case "deleted":
      return Object.freeze({ ...base, availability: input.availability })
    case "ready":
      return Object.freeze({
        ...base,
        availability: input.availability,
        display: Object.freeze({ ...input.display }),
      })
    case "restricted":
    case "unavailable":
      return Object.freeze({
        ...base,
        availability: input.availability,
        failure: failure(input.safeFailure),
      })
    default:
      return unreachable(input)
  }
}

export function projectPlatformCostOwnerState(input: MediaCostProjectionView): CreditCostOwnerState {
  const base = {
    costProjectionRef: input.costProjectionRef,
    ownerVersion: input.ownerVersion,
    freshness: input.freshness,
  }
  switch (input.state) {
    case "pending":
      return Object.freeze({ ...base, state: input.state })
    case "estimated":
    case "final":
      return Object.freeze({ ...base, state: input.state, amount: Object.freeze({ ...input.amount }) })
    case "corrected":
      return Object.freeze({
        ...base,
        state: input.state,
        correctsOwnerVersion: input.correctsOwnerVersion,
        amount: Object.freeze({ ...input.amount }),
      })
    case "unavailable":
      return Object.freeze({ ...base, state: input.state, safeReason: input.safeReason })
    default:
      return unreachable(input)
  }
}
