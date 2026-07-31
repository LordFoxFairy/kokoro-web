import type {
  ArtifactAvailability,
  ArtifactDeliveryAuthorizationInput,
  ArtifactPage,
  ArtifactResponse,
  ArtifactVersionPage,
  ArtifactVersionResponse,
  MediaDefinitionModelOptionPage,
  MediaOperationCommandResponse,
  MediaOperationDefinitionPage,
  MediaOperationDefinitionResponse,
  MediaOperationInput,
  MediaOperationPage,
  MediaOperationQuoteResponse,
  MediaOperationResponse,
  MediaSafeFailure,
} from "@kokoro/site-client"
import {
  createArtifactDeliveryClient,
  type ArtifactDeliveryByteRange,
  type ArtifactDeliveryResponse,
  type ArtifactDeliveryTransport,
  type PublicCommandContext,
  type createPlatformPublicClient,
  mediaCallerRequestFingerprintSha256,
} from "@kokoro/site-client/server"

const IMAGE_MEDIA_TYPES = Object.freeze({
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
} as const)

export type SiteMediaPageQuery = Readonly<{ cursor?: string; limit?: number }>

export interface SiteMediaAuthority {
  listDefinitions(query: SiteMediaPageQuery): Promise<MediaOperationDefinitionPage>
  getDefinition(definitionRef: string): Promise<MediaOperationDefinitionResponse>
  listModelOptions(definitionRef: string, query: SiteMediaPageQuery): Promise<MediaDefinitionModelOptionPage>
  quote(input: MediaOperationInput, command: PublicCommandContext): Promise<MediaOperationQuoteResponse>
  listOperations(query: SiteMediaPageQuery): Promise<MediaOperationPage>
  submit(input: MediaOperationInput, command: PublicCommandContext): Promise<MediaOperationCommandResponse>
  getOperation(operationRef: string): Promise<MediaOperationResponse>
  cancel(operationRef: string, input: Readonly<{ expectedOwnerVersion: string; reason?: string }>, command: PublicCommandContext): Promise<MediaOperationCommandResponse>
  recoverCommand(commandId: string): Promise<MediaOperationCommandResponse>
  listArtifacts(query: SiteMediaPageQuery): Promise<ArtifactPage>
  getArtifact(artifactRef: string): Promise<ArtifactResponse>
  listArtifactVersions(artifactRef: string, query: SiteMediaPageQuery): Promise<ArtifactVersionPage>
  getArtifactVersion(artifactRef: string, artifactVersionRef: string): Promise<ArtifactVersionResponse>
  artifactContent(
    artifactRef: string,
    artifactVersionRef: string,
    delivery: ArtifactDeliveryAuthorizationInput,
    options: Readonly<{
      signal: AbortSignal
      deadlineMs: number
      range?: ArtifactDeliveryByteRange
    }>,
  ): Promise<ArtifactDeliveryResponse>
}

export class SiteArtifactAvailabilityError extends Error {
  constructor(
    readonly availability: Exclude<ArtifactAvailability, "ready">,
    readonly failure?: Readonly<{ code: string; retryClass: string; safeMessage: string }>,
  ) {
    super(failure?.safeMessage ?? `Artifact is ${availability}`)
    this.name = "SiteArtifactAvailabilityError"
  }
}

type PlatformClient = ReturnType<typeof createPlatformPublicClient>

function queryData(query: SiteMediaPageQuery): Readonly<{ cursor?: string; limit?: number }> {
  return Object.freeze({
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  })
}

function nonReady(version: Extract<ArtifactVersionResponse["version"], { availability: Exclude<ArtifactAvailability, "ready"> }>): SiteArtifactAvailabilityError {
  const ownerFailure = "safeFailure" in version ? version.safeFailure as MediaSafeFailure : undefined
  return new SiteArtifactAvailabilityError(version.availability, ownerFailure === undefined ? undefined : {
    code: ownerFailure.code,
    retryClass: ownerFailure.retryClass,
    safeMessage: ownerFailure.safeMessage,
  })
}

/** Server-resolved media authority. No method accepts a project identity or Platform URL. */
export function createSiteMediaAuthority(input: Readonly<{
  projectRef: string
  platform: PlatformClient
  deliveryTransport: ArtifactDeliveryTransport
}>): SiteMediaAuthority {
  const path = { projectRef: input.projectRef }
  const authority: SiteMediaAuthority = {
    listDefinitions: (query) => input.platform.execute({
      operationId: "listMediaOperationDefinitions",
      data: { path, query: queryData(query) },
    }),
    getDefinition: (definitionRef) => input.platform.execute({
      operationId: "getMediaOperationDefinition",
      data: { path: { ...path, definitionRef } },
    }),
    listModelOptions: (definitionRef, query) => input.platform.execute({
      operationId: "listMediaOperationModelOptions",
      data: { path: { ...path, definitionRef }, query: queryData(query) },
    }),
    quote: (operationInput, command) => input.platform.execute({
      operationId: "quoteMediaOperation",
      data: { path, body: operationInput },
      command,
    }),
    listOperations: (query) => input.platform.execute({
      operationId: "listMediaOperations",
      data: { path, query: queryData(query) },
    }),
    async submit(operationInput, command) {
      const callerRequestFingerprint = await mediaCallerRequestFingerprintSha256({
        contractMajor: 1,
        ...operationInput,
      })
      return input.platform.execute({
        operationId: "submitMediaOperation",
        data: { path, body: operationInput },
        command,
        callerRequestFingerprint,
      })
    },
    getOperation: (operationRef) => input.platform.execute({
      operationId: "getMediaOperation",
      data: { path: { ...path, operationRef } },
    }),
    cancel: (operationRef, cancellation, command) => input.platform.execute({
      operationId: "cancelMediaOperation",
      data: { path: { ...path, operationRef }, body: cancellation },
      command,
    }),
    recoverCommand: (commandId) => input.platform.execute({
      operationId: "recoverMediaOperationCommand",
      data: { path: { ...path, commandId } },
    }),
    listArtifacts: (query) => input.platform.execute({
      operationId: "listArtifacts",
      data: { path, query: queryData(query) },
    }),
    getArtifact: (artifactRef) => input.platform.execute({
      operationId: "getArtifact",
      data: { path: { ...path, artifactRef } },
    }),
    listArtifactVersions: (artifactRef, query) => input.platform.execute({
      operationId: "listArtifactVersions",
      data: { path: { ...path, artifactRef }, query: queryData(query) },
    }),
    getArtifactVersion: (artifactRef, artifactVersionRef) => input.platform.execute({
      operationId: "getArtifactVersion",
      data: { path: { ...path, artifactRef, artifactVersionRef } },
    }),
    async artifactContent(artifactRef, artifactVersionRef, delivery, options) {
      const owner = await input.platform.execute({
        operationId: "getArtifactVersion",
        data: { path: { ...path, artifactRef, artifactVersionRef } },
      })
      if (
        owner.version.artifactRef !== artifactRef ||
        owner.version.artifactVersionRef !== artifactVersionRef
      ) throw new Error("Artifact owner identity conflict")
      if (owner.version.availability !== "ready") throw nonReady(owner.version)
      const issued = await input.platform.execute({
        operationId: "issueArtifactDeliveryAuthorization",
        data: { path: { ...path, artifactRef, artifactVersionRef }, body: delivery },
      })
      if (
        issued.authorization.artifactRef !== artifactRef ||
        issued.authorization.artifactVersionRef !== artifactVersionRef ||
        issued.authorization.purpose !== delivery.purpose
      ) throw new Error("Artifact delivery authorization identity conflict")
      return createArtifactDeliveryClient({ transport: input.deliveryTransport }).redeem({
        authorizationRef: issued.authorization.authorizationRef,
        deliveryCapability: issued.authorization.deliveryCapability,
        signal: options.signal,
        deadlineMs: options.deadlineMs,
        expectedByteSize: BigInt(owner.version.display.byteSize),
        expectedMediaType: IMAGE_MEDIA_TYPES[owner.version.display.format],
        ...(options.range === undefined ? {} : { range: options.range }),
      })
    },
  }
  return Object.freeze(authority)
}
