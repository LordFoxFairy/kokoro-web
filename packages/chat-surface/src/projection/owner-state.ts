import stableStringify from "fast-json-stable-stringify"
import type { MessagePartEnvelope } from "@kokoro/session-client/contracts"

type PartPayload<Kind extends MessagePartEnvelope["kind"]> =
  Extract<MessagePartEnvelope, { readonly kind: Kind }>["payload"]
type ContractMediaCandidate = PartPayload<"media-operation">["candidates"][number]
type ContractMediaFailure = Extract<ContractMediaCandidate, { readonly state: "failed" }>["safe_failure"]

export type ChatMediaFailure = Readonly<{
  code: ContractMediaFailure["code"]
  retryClass: ContractMediaFailure["retry_class"]
  safeMessage?: string
}>

type ChatMediaCandidateBase = Readonly<{
  candidateRef: string
  ordinal: number
  ownerVersion: string
}>

type ChatMediaCandidatePlainState = Exclude<
  ContractMediaCandidate["state"],
  "ready" | "restricted" | "failed"
>

export type ChatMediaCandidate =
  | (ChatMediaCandidateBase & Readonly<{ state: ChatMediaCandidatePlainState }>)
  | (ChatMediaCandidateBase & Readonly<{
      state: "ready"
      artifactRef: string
      artifactVersionRef: string
    }>)
  | (ChatMediaCandidateBase & Readonly<{
      state: "restricted" | "failed"
      failure: ChatMediaFailure
    }>)

export type ChatCostProjectionLink = Readonly<{
  costProjectionRef: string
  ownerVersion: string
}>

type ChatMediaOperationBase = Readonly<{
  mediaOperationRef: string
  definitionRef: string
  definitionRevisionRef: string
  ownerVersion: string
  progressBps: number
  candidates: readonly ChatMediaCandidate[]
  costProjection?: ChatCostProjectionLink
  updatedAt: string
}>

type ContractMediaOperationState = PartPayload<"media-operation">["state"]
type ChatMediaOperationNonterminalState = Exclude<
  ContractMediaOperationState,
  "completed" | "partial" | "failed" | "canceled"
>

export type ChatMediaOperationOwnerState =
  | (ChatMediaOperationBase & Readonly<{ state: ChatMediaOperationNonterminalState }>)
  | (ChatMediaOperationBase & Readonly<{
      state: "completed" | "partial" | "canceled"
      outcomeClass: "canonical" | "irreconcilable"
    }>)
  | (ChatMediaOperationBase & Readonly<{
      state: "failed"
      outcomeClass: "canonical" | "irreconcilable"
      failure: ChatMediaFailure
    }>)

export type ChatArtifactImageDisplay = Readonly<{
  format: "png" | "jpeg" | "webp"
  width: number
  height: number
  byteSize: string
}>

type ChatArtifactBase = Readonly<{
  artifactRef: string
  artifactVersionRef: string
  ownerVersion: string
  mediaClass: "image"
  updatedAt: string
}>

export type ChatArtifactOwnerState =
  | (ChatArtifactBase & Readonly<{ availability: "processing" | "deleted" }>)
  | (ChatArtifactBase & Readonly<{
      availability: "ready"
      display: ChatArtifactImageDisplay
    }>)
  | (ChatArtifactBase & Readonly<{
      availability: "restricted" | "unavailable"
      failure: ChatMediaFailure
    }>)

export type ChatCreditCostAmount = Readonly<{
  creditUnit: string
  amount: string
}>

type ChatCostBase = Readonly<{
  mediaOperationRef: string
  costProjectionRef: string
  ownerVersion: string
  freshness: PartPayload<"cost">["freshness"]
  updatedAt: string
}>

export type ChatCostOwnerState =
  | (ChatCostBase & Readonly<{ state: "pending" }>)
  | (ChatCostBase & Readonly<{
      state: "estimated" | "final"
      amount: ChatCreditCostAmount
    }>)
  | (ChatCostBase & Readonly<{
      state: "corrected"
      correctsOwnerVersion: string
      amount: ChatCreditCostAmount
    }>)
  | (ChatCostBase & Readonly<{
      state: "unavailable"
      safeReason: string
    }>)

export type OwnerTransitionConflict =
  | "owner_identity_conflict"
  | "owner_version_regression"
  | "owner_version_conflict"
  | "candidate_identity_conflict"
  | "candidate_owner_version_regression"
  | "candidate_owner_version_conflict"
  | "candidate_terminal_state_conflict"
  | "cost_projection_identity_conflict"
  | "cost_projection_owner_version_regression"
  | "media_terminal_state_conflict"

function unreachable(value: never): never {
  throw new Error(`Unreachable owner state: ${JSON.stringify(value)}`)
}

function projectFailure(failure: ContractMediaFailure): ChatMediaFailure {
  return {
    code: failure.code,
    retryClass: failure.retry_class,
    ...(failure.safe_message === undefined ? {} : { safeMessage: failure.safe_message }),
  }
}

function projectCandidate(candidate: ContractMediaCandidate): ChatMediaCandidate {
  const base = {
    candidateRef: candidate.candidate_ref,
    ordinal: candidate.ordinal,
    ownerVersion: candidate.owner_version,
  }
  switch (candidate.state) {
    case "allocated":
    case "producing":
    case "output_received":
    case "validating":
    case "unknown":
    case "cancel_requested":
    case "canceled":
      return { ...base, state: candidate.state }
    case "ready":
      return {
        ...base,
        state: candidate.state,
        artifactRef: candidate.artifact_ref,
        artifactVersionRef: candidate.artifact_version_ref,
      }
    case "restricted":
    case "failed":
      return { ...base, state: candidate.state, failure: projectFailure(candidate.safe_failure) }
    default:
      return unreachable(candidate)
  }
}

export function projectMediaOperationOwnerState(
  payload: PartPayload<"media-operation">,
): ChatMediaOperationOwnerState {
  const base = {
    mediaOperationRef: payload.media_operation_ref,
    definitionRef: payload.definition_ref,
    definitionRevisionRef: payload.definition_revision_ref,
    ownerVersion: payload.owner_version,
    progressBps: payload.progress_bps,
    candidates: payload.candidates.map(projectCandidate),
    ...(payload.cost_projection === undefined ? {} : {
      costProjection: {
        costProjectionRef: payload.cost_projection.cost_projection_ref,
        ownerVersion: payload.cost_projection.owner_version,
      },
    }),
    updatedAt: payload.updated_at,
  }
  switch (payload.state) {
    case "admission_pending":
    case "authorized":
    case "queued":
    case "active":
    case "finalizing":
    case "cancel_requested":
    case "reconciling":
      return { ...base, state: payload.state }
    case "completed":
    case "partial":
    case "canceled":
      return { ...base, state: payload.state, outcomeClass: payload.outcome_class }
    case "failed":
      return {
        ...base,
        state: payload.state,
        outcomeClass: payload.outcome_class,
        failure: projectFailure(payload.safe_failure),
      }
    default:
      return unreachable(payload)
  }
}

export function projectArtifactOwnerState(payload: PartPayload<"artifact">): ChatArtifactOwnerState {
  const base = {
    artifactRef: payload.artifact_ref,
    artifactVersionRef: payload.artifact_version_ref,
    ownerVersion: payload.owner_version,
    mediaClass: payload.media_class,
    updatedAt: payload.updated_at,
  }
  switch (payload.availability) {
    case "processing":
    case "deleted":
      return { ...base, availability: payload.availability }
    case "ready":
      return {
        ...base,
        availability: payload.availability,
        display: {
          format: payload.payload.format,
          width: payload.payload.width,
          height: payload.payload.height,
          byteSize: payload.payload.byte_size,
        },
      }
    case "restricted":
    case "unavailable":
      return {
        ...base,
        availability: payload.availability,
        failure: projectFailure(payload.safe_failure),
      }
    default:
      return unreachable(payload)
  }
}

function projectAmount(payload: { readonly credit_unit: string; readonly amount: string }): ChatCreditCostAmount {
  return { creditUnit: payload.credit_unit, amount: payload.amount }
}

export function projectCostOwnerState(payload: PartPayload<"cost">): ChatCostOwnerState {
  const base = {
    mediaOperationRef: payload.media_operation_ref,
    costProjectionRef: payload.cost_projection_ref,
    ownerVersion: payload.owner_version,
    freshness: payload.freshness,
    updatedAt: payload.updated_at,
  }
  switch (payload.state) {
    case "pending":
      return { ...base, state: payload.state }
    case "estimated":
    case "final":
      return { ...base, state: payload.state, amount: projectAmount(payload.payload) }
    case "corrected":
      return {
        ...base,
        state: payload.state,
        correctsOwnerVersion: payload.corrects_owner_version,
        amount: projectAmount(payload.payload),
      }
    case "unavailable":
      return { ...base, state: payload.state, safeReason: payload.safe_reason }
    default:
      return unreachable(payload)
  }
}

function ownerVersionConflict(
  currentVersion: string,
  nextVersion: string,
  current: unknown,
  next: unknown,
): "owner_version_regression" | "owner_version_conflict" | undefined {
  const currentValue = BigInt(currentVersion)
  const nextValue = BigInt(nextVersion)
  if (nextValue < currentValue) return "owner_version_regression"
  if (nextValue === currentValue && ownerFingerprint(current) !== ownerFingerprint(next)) {
    return "owner_version_conflict"
  }
  return undefined
}

function ownerFingerprint(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return stableStringify(value)
  const owner = Object.fromEntries(
    Object.entries(value).filter(([key]) => !["id", "kind", "lifecycle", "ordinal", "version"].includes(key)),
  )
  return stableStringify(owner)
}

const MEDIA_TERMINAL_STATES = new Set<ChatMediaOperationOwnerState["state"]>([
  "completed", "partial", "failed", "canceled",
])
const CANDIDATE_TERMINAL_STATES = new Set<ChatMediaCandidate["state"]>([
  "ready", "restricted", "failed", "canceled",
])

export function validateMediaOperationTransition(
  current: ChatMediaOperationOwnerState,
  next: ChatMediaOperationOwnerState,
): OwnerTransitionConflict | undefined {
  if (
    current.mediaOperationRef !== next.mediaOperationRef ||
    current.definitionRef !== next.definitionRef ||
    current.definitionRevisionRef !== next.definitionRevisionRef
  ) return "owner_identity_conflict"
  const versionConflict = ownerVersionConflict(current.ownerVersion, next.ownerVersion, current, next)
  if (versionConflict !== undefined) return versionConflict
  if (MEDIA_TERMINAL_STATES.has(current.state) && next.state !== current.state) {
    return "media_terminal_state_conflict"
  }
  if (current.candidates.length !== next.candidates.length) return "candidate_identity_conflict"
  const nextByRef = new Map(next.candidates.map((candidate) => [candidate.candidateRef, candidate]))
  for (const candidate of current.candidates) {
    const updated = nextByRef.get(candidate.candidateRef)
    if (updated === undefined || updated.ordinal !== candidate.ordinal) return "candidate_identity_conflict"
    const currentVersion = BigInt(candidate.ownerVersion)
    const nextVersion = BigInt(updated.ownerVersion)
    if (nextVersion < currentVersion) return "candidate_owner_version_regression"
    if (nextVersion === currentVersion && stableStringify(candidate) !== stableStringify(updated)) {
      return "candidate_owner_version_conflict"
    }
    if (CANDIDATE_TERMINAL_STATES.has(candidate.state) && updated.state !== candidate.state) {
      return "candidate_terminal_state_conflict"
    }
    if (
      candidate.state === "ready" && updated.state === "ready" &&
      (candidate.artifactRef !== updated.artifactRef || candidate.artifactVersionRef !== updated.artifactVersionRef)
    ) return "candidate_identity_conflict"
  }
  if (current.costProjection !== undefined) {
    if (
      next.costProjection === undefined ||
      current.costProjection.costProjectionRef !== next.costProjection.costProjectionRef
    ) return "cost_projection_identity_conflict"
    if (BigInt(next.costProjection.ownerVersion) < BigInt(current.costProjection.ownerVersion)) {
      return "cost_projection_owner_version_regression"
    }
  }
  return undefined
}

export function validateArtifactTransition(
  current: ChatArtifactOwnerState,
  next: ChatArtifactOwnerState,
): OwnerTransitionConflict | undefined {
  if (
    current.artifactRef !== next.artifactRef ||
    current.artifactVersionRef !== next.artifactVersionRef ||
    current.mediaClass !== next.mediaClass
  ) return "owner_identity_conflict"
  return ownerVersionConflict(current.ownerVersion, next.ownerVersion, current, next)
}

export function validateCostTransition(
  current: ChatCostOwnerState,
  next: ChatCostOwnerState,
): OwnerTransitionConflict | undefined {
  if (
    current.mediaOperationRef !== next.mediaOperationRef ||
    current.costProjectionRef !== next.costProjectionRef
  ) return "owner_identity_conflict"
  return ownerVersionConflict(current.ownerVersion, next.ownerVersion, current, next)
}
