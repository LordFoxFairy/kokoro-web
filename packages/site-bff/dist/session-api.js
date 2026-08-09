import "server-only";
import { randomUUID } from "node:crypto";
import { matchSessionBrowserV3Request, SessionAccessError, SessionProxyError, SiteBindingError, } from "@kokoro/bff-runtime";
import { SESSION_FAILURE_PHASE_HEADER, } from "@kokoro/session-client";
import { errorEnvelopeSchema } from "@kokoro/session-client/contracts";
import { PlatformPublicError } from "@kokoro/site-client/server";
const MAXIMUM_BODY_BYTES = 2_097_152;
const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
function problem(status, code, action, retryClass, message, failurePhase) {
    const requestId = randomUUID();
    const headers = {
        "cache-control": "no-store",
        "content-type": "application/problem+json; charset=utf-8",
    };
    if (failurePhase !== undefined)
        headers[SESSION_FAILURE_PHASE_HEADER] = failurePhase;
    const envelope = errorEnvelopeSchema.parse({
        error: { code, message, retry_class: retryClass, action },
        request_id: requestId,
        correlation_id: requestId,
    });
    return new Response(JSON.stringify(envelope), { status, headers });
}
async function boundedJson(request) {
    const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json")
        throw new SyntaxError("unsupported media type");
    const declared = request.headers.get("content-length");
    if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_BODY_BYTES)) {
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
            if (size > MAXIMUM_BODY_BYTES) {
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
function unavailable(status, context, failurePhase) {
    if (MUTATIONS.has(context.method)) {
        return problem(status, "INTERNAL_UNAVAILABLE", "reconcile_receipt", "reconcile_receipt", "Session command outcome is being reconciled", failurePhase);
    }
    if (context.operationId === "stream") {
        return problem(status, "INTERNAL_UNAVAILABLE", "retry_same_cursor", "after_delay", "Session stream is temporarily unavailable", failurePhase);
    }
    return problem(status, "INTERNAL_UNAVAILABLE", "refetch_snapshot", "after_delay", "Session is temporarily unavailable", failurePhase);
}
function internalFailurePhase(error, boundaryPhase) {
    if (boundaryPhase === "auth_session_read" || boundaryPhase === "runtime_assembly")
        return boundaryPhase;
    if (error instanceof SessionAccessError)
        return "grant_validation";
    if (error instanceof PlatformPublicError)
        return "grant_authority";
    if (error instanceof SessionProxyError && (error.code === "UPSTREAM_BINDING_MISMATCH" || error.code === "UPSTREAM_PROTOCOL_ERROR"))
        return "upstream_contract";
    if (error instanceof Error && error.name === "NodeSiteRuntimeError")
        return "upstream_transport";
    return "proxy_internal";
}
function failure(error, context) {
    if (error instanceof RangeError) {
        return problem(413, "PAYLOAD_TOO_LARGE", "stop", "never", "Request body is too large");
    }
    if (error instanceof SyntaxError) {
        return problem(400, "REQUEST_INVALID", "stop", "never", "Request was rejected");
    }
    if (error instanceof SessionProxyError) {
        if (error.code === "BROWSER_AUTHORITY_FORBIDDEN" || error.code === "BROWSER_HEADER_FORBIDDEN" ||
            error.code === "BROWSER_REQUEST_UNVERIFIED") {
            return problem(403, "REQUEST_INVALID", "stop", "never", "Browser request was rejected");
        }
        if (error.code === "REQUEST_INVALID") {
            return problem(400, "REQUEST_INVALID", "stop", "never", "Request was rejected");
        }
        return unavailable(502, context, internalFailurePhase(error, context.boundaryPhase));
    }
    if (error instanceof PlatformPublicError) {
        if (error.status === 401) {
            return problem(401, "SESSION_ACCESS_GRANT_REQUIRED", "reauthenticate", "never", "Sign in again");
        }
        if (error.status === 403) {
            return problem(403, "SESSION_ACCESS_GRANT_REVOKED", "reauthenticate", "never", "Session access was revoked");
        }
    }
    if (error instanceof SiteBindingError && (error.code === "AUTH_SESSION_INVALID" || error.code.startsWith("PERSONAL_CONTEXT_"))) {
        return problem(401, "SESSION_ACCESS_GRANT_REQUIRED", "reauthenticate", "never", "Sign in again");
    }
    if (error instanceof Error && error.name === "NodeSiteRuntimeError") {
        return unavailable(503, context, internalFailurePhase(error, context.boundaryPhase));
    }
    return unavailable(503, context, internalFailurePhase(error, context.boundaryPhase));
}
/** Closed Session Browser v3 adapter. The generated operation registry is the only route authority. */
export function createSiteSessionApi(input) {
    return Object.freeze({
        async handle(request, path) {
            let operationId;
            let boundaryPhase = "auth_session_read";
            try {
                const fetchSite = request.headers.get("sec-fetch-site");
                const origin = request.headers.get("origin");
                if (fetchSite !== "same-origin" || (MUTATIONS.has(request.method) && origin !== input.runtime.publicOrigin)) {
                    return problem(403, "REQUEST_INVALID", "stop", "never", "Browser request was rejected");
                }
                const auth = await input.readAuthSession();
                if (auth === null) {
                    return problem(401, "SESSION_ACCESS_GRANT_REQUIRED", "reauthenticate", "never", "Sign in again");
                }
                const url = new URL(request.url);
                boundaryPhase = "proxy_internal";
                const matched = matchSessionBrowserV3Request({
                    method: request.method,
                    pathname: `/${path.join("/")}`,
                    searchParams: url.searchParams,
                });
                operationId = matched.operationId;
                const headers = new Headers({ origin: input.runtime.publicOrigin, "sec-fetch-site": fetchSite });
                for (const name of ["accept", "content-type", "last-event-id", "x-csrf-token"]) {
                    const value = request.headers.get(name);
                    if (value !== null)
                        headers.set(name, value);
                }
                boundaryPhase = "runtime_assembly";
                const session = await input.runtime.assemble(auth);
                boundaryPhase = "proxy_internal";
                return await session.proxy.execute({
                    operationId: matched.operationId,
                    projectRef: session.bootstrap.defaultProjectRef,
                    browser: {
                        method: request.method,
                        headers,
                        pathParameters: matched.pathParameters,
                        query: matched.query,
                        body: request.method === "GET" ? undefined : await boundedJson(request),
                        signal: request.signal,
                    },
                });
            }
            catch (error) {
                return failure(error, {
                    method: request.method,
                    boundaryPhase,
                    ...(operationId === undefined ? {} : { operationId }),
                });
            }
        },
    });
}
//# sourceMappingURL=session-api.js.map