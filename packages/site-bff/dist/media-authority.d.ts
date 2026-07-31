import type { ArtifactAvailability, ArtifactDeliveryAuthorizationInput, ArtifactPage, ArtifactResponse, ArtifactVersionPage, ArtifactVersionResponse, MediaDefinitionModelOptionPage, MediaOperationCommandResponse, MediaOperationDefinitionPage, MediaOperationDefinitionResponse, MediaOperationInput, MediaOperationPage, MediaOperationQuoteResponse, MediaOperationResponse } from "@kokoro/site-client";
import { type ArtifactDeliveryByteRange, type ArtifactDeliveryResponse, type ArtifactDeliveryTransport, type PublicCommandContext, type createPlatformPublicClient } from "@kokoro/site-client/server";
export type SiteMediaPageQuery = Readonly<{
    cursor?: string;
    limit?: number;
}>;
export interface SiteMediaAuthority {
    listDefinitions(query: SiteMediaPageQuery): Promise<MediaOperationDefinitionPage>;
    getDefinition(definitionRef: string): Promise<MediaOperationDefinitionResponse>;
    listModelOptions(definitionRef: string, query: SiteMediaPageQuery): Promise<MediaDefinitionModelOptionPage>;
    quote(input: MediaOperationInput, command: PublicCommandContext): Promise<MediaOperationQuoteResponse>;
    listOperations(query: SiteMediaPageQuery): Promise<MediaOperationPage>;
    submit(input: MediaOperationInput, command: PublicCommandContext): Promise<MediaOperationCommandResponse>;
    getOperation(operationRef: string): Promise<MediaOperationResponse>;
    cancel(operationRef: string, input: Readonly<{
        expectedOwnerVersion: string;
        reason?: string;
    }>, command: PublicCommandContext): Promise<MediaOperationCommandResponse>;
    recoverCommand(commandId: string): Promise<MediaOperationCommandResponse>;
    listArtifacts(query: SiteMediaPageQuery): Promise<ArtifactPage>;
    getArtifact(artifactRef: string): Promise<ArtifactResponse>;
    listArtifactVersions(artifactRef: string, query: SiteMediaPageQuery): Promise<ArtifactVersionPage>;
    getArtifactVersion(artifactRef: string, artifactVersionRef: string): Promise<ArtifactVersionResponse>;
    artifactContent(artifactRef: string, artifactVersionRef: string, delivery: ArtifactDeliveryAuthorizationInput, options: Readonly<{
        signal: AbortSignal;
        deadlineMs: number;
        range?: ArtifactDeliveryByteRange;
    }>): Promise<ArtifactDeliveryResponse>;
}
export declare class SiteArtifactAvailabilityError extends Error {
    readonly availability: Exclude<ArtifactAvailability, "ready">;
    readonly failure?: Readonly<{
        code: string;
        retryClass: string;
        safeMessage: string;
    }> | undefined;
    constructor(availability: Exclude<ArtifactAvailability, "ready">, failure?: Readonly<{
        code: string;
        retryClass: string;
        safeMessage: string;
    }> | undefined);
}
type PlatformClient = ReturnType<typeof createPlatformPublicClient>;
/** Server-resolved media authority. No method accepts a project identity or Platform URL. */
export declare function createSiteMediaAuthority(input: Readonly<{
    projectRef: string;
    platform: PlatformClient;
    deliveryTransport: ArtifactDeliveryTransport;
}>): SiteMediaAuthority;
export {};
//# sourceMappingURL=media-authority.d.ts.map