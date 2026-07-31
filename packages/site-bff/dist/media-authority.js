import { createArtifactDeliveryClient, mediaCallerRequestFingerprintSha256, } from "@kokoro/site-client/server";
const IMAGE_MEDIA_TYPES = Object.freeze({
    png: "image/png",
    jpeg: "image/jpeg",
    webp: "image/webp",
});
export class SiteArtifactAvailabilityError extends Error {
    availability;
    failure;
    constructor(availability, failure) {
        super(failure?.safeMessage ?? `Artifact is ${availability}`);
        this.availability = availability;
        this.failure = failure;
        this.name = "SiteArtifactAvailabilityError";
    }
}
function queryData(query) {
    return Object.freeze({
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
}
function nonReady(version) {
    const ownerFailure = "safeFailure" in version ? version.safeFailure : undefined;
    return new SiteArtifactAvailabilityError(version.availability, ownerFailure === undefined ? undefined : {
        code: ownerFailure.code,
        retryClass: ownerFailure.retryClass,
        safeMessage: ownerFailure.safeMessage,
    });
}
/** Server-resolved media authority. No method accepts a project identity or Platform URL. */
export function createSiteMediaAuthority(input) {
    const path = { projectRef: input.projectRef };
    const authority = {
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
            });
            return input.platform.execute({
                operationId: "submitMediaOperation",
                data: { path, body: operationInput },
                command,
                callerRequestFingerprint,
            });
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
            });
            if (owner.version.artifactRef !== artifactRef ||
                owner.version.artifactVersionRef !== artifactVersionRef)
                throw new Error("Artifact owner identity conflict");
            if (owner.version.availability !== "ready")
                throw nonReady(owner.version);
            const issued = await input.platform.execute({
                operationId: "issueArtifactDeliveryAuthorization",
                data: { path: { ...path, artifactRef, artifactVersionRef }, body: delivery },
            });
            if (issued.authorization.artifactRef !== artifactRef ||
                issued.authorization.artifactVersionRef !== artifactVersionRef ||
                issued.authorization.purpose !== delivery.purpose)
                throw new Error("Artifact delivery authorization identity conflict");
            return createArtifactDeliveryClient({ transport: input.deliveryTransport }).redeem({
                authorizationRef: issued.authorization.authorizationRef,
                deliveryCapability: issued.authorization.deliveryCapability,
                signal: options.signal,
                deadlineMs: options.deadlineMs,
                expectedByteSize: BigInt(owner.version.display.byteSize),
                expectedMediaType: IMAGE_MEDIA_TYPES[owner.version.display.format],
                ...(options.range === undefined ? {} : { range: options.range }),
            });
        },
    };
    return Object.freeze(authority);
}
//# sourceMappingURL=media-authority.js.map