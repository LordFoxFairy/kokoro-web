import { createArtifactDeliveryClient, mediaCallerRequestFingerprintSha256, PlatformPublicProtocolError, } from "@kokoro/site-client/server";
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
        listDefinitions: (query, options) => input.platform.execute({
            operationId: "listMediaOperationDefinitions",
            data: { path, query: queryData(query) },
            ...options,
        }),
        getDefinition: (definitionRef, options) => input.platform.execute({
            operationId: "getMediaOperationDefinition",
            data: { path: { ...path, definitionRef } },
            ...options,
        }),
        listModelOptions: (definitionRef, query, options) => input.platform.execute({
            operationId: "listMediaOperationModelOptions",
            data: { path: { ...path, definitionRef }, query: queryData(query) },
            ...options,
        }),
        quote: (operationInput, command, options) => input.platform.execute({
            operationId: "quoteMediaOperation",
            data: { path, body: operationInput },
            command,
            ...options,
        }),
        listOperations: (query, options) => input.platform.execute({
            operationId: "listMediaOperations",
            data: { path, query: queryData(query) },
            ...options,
        }),
        async submit(operationInput, command, options) {
            const callerRequestFingerprint = await mediaCallerRequestFingerprintSha256({
                contractMajor: 1,
                ...operationInput,
            });
            const response = await input.platform.execute({
                operationId: "submitMediaOperation",
                data: { path, body: operationInput },
                command,
                callerRequestFingerprint,
                ...options,
            });
            if (!response.receipt.receiptKind.startsWith("submit_") ||
                !("callerRequestFingerprint" in response.receipt) ||
                response.receipt.callerRequestFingerprint !== callerRequestFingerprint)
                throw new PlatformPublicProtocolError("submitMediaOperation", "success_response", 202);
            return response;
        },
        getOperation: (operationRef, options) => input.platform.execute({
            operationId: "getMediaOperation",
            data: { path: { ...path, operationRef } },
            ...options,
        }),
        cancel: (operationRef, cancellation, command, options) => input.platform.execute({
            operationId: "cancelMediaOperation",
            data: { path: { ...path, operationRef }, body: cancellation },
            command,
            ...options,
        }),
        recoverCommand: (commandId, options) => input.platform.execute({
            operationId: "recoverMediaOperationCommand",
            data: { path: { ...path, commandId } },
            ...options,
        }),
        listArtifacts: (query, options) => input.platform.execute({
            operationId: "listArtifacts",
            data: { path, query: queryData(query) },
            ...options,
        }),
        getArtifact: (artifactRef, options) => input.platform.execute({
            operationId: "getArtifact",
            data: { path: { ...path, artifactRef } },
            ...options,
        }),
        listArtifactVersions: (artifactRef, query, options) => input.platform.execute({
            operationId: "listArtifactVersions",
            data: { path: { ...path, artifactRef }, query: queryData(query) },
            ...options,
        }),
        getArtifactVersion: (artifactRef, artifactVersionRef, options) => input.platform.execute({
            operationId: "getArtifactVersion",
            data: { path: { ...path, artifactRef, artifactVersionRef } },
            ...options,
        }),
        async artifactContent(artifactRef, artifactVersionRef, delivery, options) {
            const clock = input.now ?? Date.now;
            const startedAt = clock();
            const remainingDeadlineMs = () => {
                const remaining = options.deadlineMs - Math.max(0, clock() - startedAt);
                if (!Number.isFinite(remaining) || remaining < 1)
                    throw new Error("Artifact delivery deadline exhausted");
                return Math.max(1, Math.floor(remaining));
            };
            const owner = await input.platform.execute({
                operationId: "getArtifactVersion",
                data: { path: { ...path, artifactRef, artifactVersionRef } },
                signal: options.signal,
                deadlineMs: remainingDeadlineMs(),
            });
            if (owner.version.artifactRef !== artifactRef ||
                owner.version.artifactVersionRef !== artifactVersionRef)
                throw new Error("Artifact owner identity conflict");
            if (owner.version.availability !== "ready")
                throw nonReady(owner.version);
            const issued = await input.platform.execute({
                operationId: "issueArtifactDeliveryAuthorization",
                data: { path: { ...path, artifactRef, artifactVersionRef }, body: delivery },
                signal: options.signal,
                deadlineMs: remainingDeadlineMs(),
            });
            if (issued.authorization.artifactRef !== artifactRef ||
                issued.authorization.artifactVersionRef !== artifactVersionRef ||
                issued.authorization.purpose !== delivery.purpose)
                throw new Error("Artifact delivery authorization identity conflict");
            return createArtifactDeliveryClient({ transport: input.deliveryTransport }).redeem({
                authorizationRef: issued.authorization.authorizationRef,
                deliveryCapability: issued.authorization.deliveryCapability,
                signal: options.signal,
                deadlineMs: remainingDeadlineMs(),
                expectedByteSize: BigInt(owner.version.display.byteSize),
                expectedMediaType: IMAGE_MEDIA_TYPES[owner.version.display.format],
                ...(options.range === undefined ? {} : { range: options.range }),
            });
        },
    };
    return Object.freeze(authority);
}
//# sourceMappingURL=media-authority.js.map