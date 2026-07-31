import "server-only";
import { ArtifactDeliveryError, ArtifactDeliveryInputError, ArtifactDeliveryProtocolError, PlatformPublicError, PlatformPublicInputError, } from "@kokoro/site-client/server";
import { SiteArtifactAvailabilityError } from "./media-authority.js";
const MAXIMUM_CONTROL_BODY_BYTES = 65_536;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{2,255}$/u;
const COMMAND_ID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const IDEMPOTENCY_KEY = /^\S{16,191}$/u;
const ASPECT_RATIOS = new Set([
    "square_1_1", "landscape_4_3", "landscape_16_9", "portrait_3_4", "portrait_9_16",
]);
const OUTPUT_FORMATS = new Set(["png", "jpeg", "webp"]);
function problem(status, code, message) {
    return Response.json({ error: { code, message } }, {
        status,
        headers: { "cache-control": "no-store" },
    });
}
async function boundedJson(request) {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json")
        throw new SyntaxError("content type");
    const declared = request.headers.get("content-length");
    if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_CONTROL_BODY_BYTES)) {
        await request.body?.cancel("body too large").catch(() => undefined);
        throw new RangeError("body too large");
    }
    if (request.body === null)
        throw new SyntaxError("missing body");
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done)
                break;
            size += next.value.byteLength;
            if (size > MAXIMUM_CONTROL_BODY_BYTES) {
                await reader.cancel("body too large");
                throw new RangeError("body too large");
            }
            chunks.push(next.value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function record(value, required, optional = []) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new SyntaxError("object");
    const input = value;
    const allowed = new Set([...required, ...optional]);
    if (required.some((key) => !(key in input)) || Object.keys(input).some((key) => !allowed.has(key))) {
        throw new SyntaxError("shape");
    }
    return input;
}
function text(value, maximum = 2_048) {
    if (typeof value !== "string" || value.length < 1 || value.length > maximum)
        throw new SyntaxError("text");
    return value;
}
function utf8Text(value, maximumBytes) {
    if (typeof value !== "string" || value.length < 1 || new TextEncoder().encode(value).byteLength > maximumBytes) {
        throw new SyntaxError("utf8 text");
    }
    return value;
}
function command(value) {
    const input = record(value, ["commandId", "idempotencyKey"]);
    const commandId = text(input.commandId, 64);
    const idempotencyKey = text(input.idempotencyKey, 191);
    if (!COMMAND_ID.test(commandId) || !IDEMPOTENCY_KEY.test(idempotencyKey))
        throw new SyntaxError("command");
    return Object.freeze({ commandId, idempotencyKey });
}
function mediaInput(value) {
    const input = record(value, [
        "kind", "definitionRevisionRef", "promptIntent", "aspectRatio", "candidateCount",
        "modelOptionRevisionRef", "outputFormat",
    ]);
    const aspectRatio = text(input.aspectRatio, 32);
    const outputFormat = text(input.outputFormat, 16);
    if (input.kind !== "image_text_to_image" || !ASPECT_RATIOS.has(aspectRatio) || !OUTPUT_FORMATS.has(outputFormat) ||
        !Number.isInteger(input.candidateCount) || input.candidateCount < 1 || input.candidateCount > 4)
        throw new SyntaxError("media input");
    return Object.freeze({
        kind: "image_text_to_image",
        definitionRevisionRef: text(input.definitionRevisionRef, 256),
        promptIntent: utf8Text(input.promptIntent, 32_768),
        aspectRatio,
        candidateCount: input.candidateCount,
        modelOptionRevisionRef: text(input.modelOptionRevisionRef, 256),
        outputFormat,
    });
}
function commandInput(value) {
    const input = record(value, ["command", "input"]);
    return Object.freeze({ command: command(input.command), input: mediaInput(input.input) });
}
function cancellationInput(value) {
    const input = record(value, ["command", "expectedOwnerVersion"], ["reason"]);
    const reason = input.reason === undefined ? undefined : text(input.reason, 512);
    return Object.freeze({
        command: command(input.command),
        cancellation: Object.freeze({
            expectedOwnerVersion: text(input.expectedOwnerVersion, 20),
            ...(reason === undefined ? {} : { reason }),
        }),
    });
}
function pageQuery(url) {
    if ([...url.searchParams.keys()].some((key) => key !== "cursor" && key !== "limit"))
        throw new SyntaxError("query");
    if (url.searchParams.getAll("cursor").length > 1 || url.searchParams.getAll("limit").length > 1)
        throw new SyntaxError("query");
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const rawLimit = url.searchParams.get("limit") ?? undefined;
    if (cursor !== undefined && (cursor.length < 1 || cursor.length > 2_048))
        throw new SyntaxError("cursor");
    if (rawLimit !== undefined && (!/^[1-9][0-9]{0,2}$/u.test(rawLimit) || Number(rawLimit) > 100)) {
        throw new SyntaxError("limit");
    }
    return Object.freeze({
        ...(cursor === undefined ? {} : { cursor }),
        ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
    });
}
function contentUrl(artifactRef, artifactVersionRef) {
    return `/api/media/artifacts/${encodeURIComponent(artifactRef)}/versions/${encodeURIComponent(artifactVersionRef)}/content?purpose=preview&viewport=thumbnail`;
}
function artifactProjection(artifact) {
    return Object.freeze({
        ...artifact,
        ...(artifact.availability === "ready" ? {
            contentUrl: contentUrl(artifact.artifactRef, artifact.currentArtifactVersionRef),
        } : {}),
    });
}
function versionProjection(version) {
    return Object.freeze({
        ...version,
        ...(version.availability === "ready" ? {
            contentUrl: contentUrl(version.artifactRef, version.artifactVersionRef),
        } : {}),
    });
}
function delivery(url) {
    const purposeValues = url.searchParams.getAll("purpose");
    if (purposeValues.length !== 1)
        throw new SyntaxError("purpose");
    const purpose = purposeValues[0];
    if (purpose === "preview") {
        if ([...url.searchParams.keys()].some((key) => key !== "purpose" && key !== "viewport"))
            throw new SyntaxError("query");
        const viewportValues = url.searchParams.getAll("viewport");
        if (viewportValues.length !== 1)
            throw new SyntaxError("viewport");
        const viewportClass = viewportValues[0];
        if (viewportClass !== "thumbnail" && viewportClass !== "canvas" && viewportClass !== "full")
            throw new SyntaxError("viewport");
        return Object.freeze({ purpose, viewportClass });
    }
    if (purpose === "download") {
        if ([...url.searchParams.keys()].some((key) => key !== "purpose" && key !== "filename"))
            throw new SyntaxError("query");
        const filenames = url.searchParams.getAll("filename");
        if (filenames.length > 1)
            throw new SyntaxError("filename");
        const suggestedFileName = filenames[0];
        return Object.freeze({ purpose, ...(suggestedFileName === undefined ? {} : { suggestedFileName: text(suggestedFileName, 255) }) });
    }
    if (purpose === "export") {
        if ([...url.searchParams.keys()].some((key) => key !== "purpose" && key !== "exportIntentRef"))
            throw new SyntaxError("query");
        const exportIntentRefs = url.searchParams.getAll("exportIntentRef");
        if (exportIntentRefs.length !== 1)
            throw new SyntaxError("exportIntentRef");
        return Object.freeze({ purpose, exportIntentRef: text(exportIntentRefs[0], 256) });
    }
    throw new SyntaxError("purpose");
}
function range(value) {
    if (value === null)
        return undefined;
    if (value.length > 64)
        throw new ArtifactDeliveryError("ARTIFACT_DELIVERY_RANGE_INVALID");
    const absolute = /^bytes=([0-9]+)-([0-9]+)$/u.exec(value);
    if (absolute !== null)
        return Object.freeze({ start: BigInt(absolute[1] ?? "0"), endInclusive: BigInt(absolute[2] ?? "0") });
    const suffix = /^bytes=-([1-9][0-9]*)$/u.exec(value);
    if (suffix !== null)
        return Object.freeze({ suffixLength: BigInt(suffix[1] ?? "0") });
    throw new ArtifactDeliveryError("ARTIFACT_DELIVERY_RANGE_INVALID");
}
function reference(value) {
    return value !== undefined && REFERENCE.test(value);
}
/** Exact Site media/artifact composition. This is deliberately not a generic Platform proxy. */
export function createSiteMediaApi(input) {
    const api = {
        async handle(request, path) {
            try {
                const url = new URL(request.url);
                if (url.origin !== input.runtime.publicOrigin || request.headers.get("sec-fetch-site") !== "same-origin") {
                    return problem(403, "REQUEST_REJECTED", "Browser request was rejected");
                }
                if (request.method === "POST" && (request.headers.get("origin") !== input.runtime.publicOrigin ||
                    !input.runtime.verifyBrowserMutation({
                        operationId: "media.control",
                        token: request.headers.get("x-kokoro-browser-csrf") ?? "",
                    })))
                    return problem(403, "REQUEST_REJECTED", "Browser request was rejected");
                const auth = await input.readAuthSession();
                if (auth === null)
                    return problem(401, "AUTH_REQUIRED", "Sign in again");
                const media = await input.runtime.media(auth);
                if (request.method === "GET" && path.length === 1 && path[0] === "definitions") {
                    return Response.json(await media.listDefinitions(pageQuery(url)), { headers: { "cache-control": "no-store" } });
                }
                if (request.method === "GET" && path.length === 2 && path[0] === "definitions" && reference(path[1])) {
                    return Response.json(await media.getDefinition(path[1]), { headers: { "cache-control": "no-store" } });
                }
                if (request.method === "GET" && path.length === 3 && path[0] === "definitions" && reference(path[1]) && path[2] === "model-options") {
                    return Response.json(await media.listModelOptions(path[1], pageQuery(url)), { headers: { "cache-control": "no-store" } });
                }
                if (request.method === "POST" && path.length === 1 && path[0] === "quotes") {
                    const parsed = commandInput(await boundedJson(request));
                    return Response.json(await media.quote(parsed.input, parsed.command), { headers: { "cache-control": "no-store" } });
                }
                if (request.method === "GET" && path.length === 1 && path[0] === "operations") {
                    return Response.json(await media.listOperations(pageQuery(url)), { headers: { "cache-control": "no-store" } });
                }
                if (request.method === "POST" && path.length === 1 && path[0] === "operations") {
                    const parsed = commandInput(await boundedJson(request));
                    return Response.json(await media.submit(parsed.input, parsed.command), { status: 202, headers: { "cache-control": "no-store" } });
                }
                if (request.method === "GET" && path.length === 2 && path[0] === "operations" && reference(path[1])) {
                    return Response.json(await media.getOperation(path[1]), { headers: { "cache-control": "no-store" } });
                }
                if (request.method === "POST" && path.length === 3 && path[0] === "operations" && reference(path[1]) && path[2] === "cancel") {
                    const parsed = cancellationInput(await boundedJson(request));
                    return Response.json(await media.cancel(path[1], parsed.cancellation, parsed.command), { status: 202, headers: { "cache-control": "no-store" } });
                }
                if (request.method === "GET" && path.length === 2 && path[0] === "commands" && reference(path[1])) {
                    if (url.search !== "")
                        throw new SyntaxError("query");
                    return Response.json(await media.recoverCommand(path[1]), { headers: { "cache-control": "no-store" } });
                }
                if (request.method === "GET" && path.length === 1 && path[0] === "artifacts") {
                    const page = await media.listArtifacts(pageQuery(url));
                    return Response.json({ ...page, items: page.items.map(artifactProjection) }, { headers: { "cache-control": "no-store" } });
                }
                if (request.method === "GET" && path.length === 2 && path[0] === "artifacts" && reference(path[1])) {
                    if (url.search !== "")
                        throw new SyntaxError("query");
                    const response = await media.getArtifact(path[1]);
                    return Response.json({ artifact: artifactProjection(response.artifact) }, { headers: { "cache-control": "no-store" } });
                }
                if (request.method === "GET" && path.length === 3 && path[0] === "artifacts" && reference(path[1]) && path[2] === "versions") {
                    const page = await media.listArtifactVersions(path[1], pageQuery(url));
                    return Response.json({ ...page, items: page.items.map(versionProjection) }, { headers: { "cache-control": "no-store" } });
                }
                if (request.method === "GET" && path.length === 4 && path[0] === "artifacts" && reference(path[1]) && path[2] === "versions" && reference(path[3])) {
                    if (url.search !== "")
                        throw new SyntaxError("query");
                    const response = await media.getArtifactVersion(path[1], path[3]);
                    return Response.json({ version: versionProjection(response.version) }, { headers: { "cache-control": "no-store" } });
                }
                if (request.method === "GET" && path.length === 5 && path[0] === "artifacts" && reference(path[1]) && path[2] === "versions" && reference(path[3]) && path[4] === "content") {
                    const response = await media.artifactContent(path[1], path[3], delivery(url), {
                        signal: request.signal,
                        deadlineMs: 30_000,
                        ...(request.headers.get("range") === null ? {} : { range: range(request.headers.get("range")) }),
                    });
                    const headers = new Headers(response.headers);
                    headers.set("cache-control", "private, no-store");
                    return new Response(response.body, { status: response.status, headers });
                }
                return problem(404, "NOT_FOUND", "Media operation was not found");
            }
            catch (error) {
                if (error instanceof RangeError)
                    return problem(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
                if (error instanceof SiteArtifactAvailabilityError) {
                    return problem(409, `ARTIFACT_${error.availability.toUpperCase()}`, error.message);
                }
                if (error instanceof ArtifactDeliveryError)
                    return problem(416, error.code, "Artifact byte range was invalid");
                if (error instanceof SyntaxError || error instanceof PlatformPublicInputError || error instanceof ArtifactDeliveryInputError) {
                    return problem(400, "REQUEST_INVALID", "Media request was invalid");
                }
                if (error instanceof PlatformPublicError)
                    return problem(error.status, error.detail.code, error.detail.safeMessage);
                if (error instanceof ArtifactDeliveryProtocolError)
                    return problem(502, error.code, "Artifact stream was rejected");
                return problem(503, "INTERNAL_UNAVAILABLE", "Media service is temporarily unavailable");
            }
        },
    };
    return Object.freeze(api);
}
//# sourceMappingURL=media-api.js.map