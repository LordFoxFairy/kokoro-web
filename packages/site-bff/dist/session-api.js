import "server-only";
import { randomUUID } from "node:crypto";
import { matchSessionBrowserV3Request, SessionProxyError, SiteBindingError, } from "@kokoro/bff-runtime";
import { errorEnvelopeSchema } from "@kokoro/session-client/contracts";
import { PlatformPublicError } from "@kokoro/site-client/server";
const MAXIMUM_BODY_BYTES = 2_097_152;
const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
function problem(status, code, action, retryClass, message) {
    const requestId = randomUUID();
    return Response.json(errorEnvelopeSchema.parse({
        error: { code, message, retry_class: retryClass, action },
        request_id: requestId,
        correlation_id: requestId,
    }), { status, headers: { "cache-control": "no-store" } });
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
function unavailable(status, context) {
    if (MUTATIONS.has(context.method)) {
        return problem(status, "INTERNAL_UNAVAILABLE", "reconcile_receipt", "reconcile_receipt", "Session command outcome is being reconciled");
    }
    if (context.operationId === "stream") {
        return problem(status, "INTERNAL_UNAVAILABLE", "retry_same_cursor", "after_delay", "Session stream is temporarily unavailable");
    }
    return problem(status, "INTERNAL_UNAVAILABLE", "refetch_snapshot", "after_delay", "Session is temporarily unavailable");
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
        return unavailable(502, context);
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
        return unavailable(503, context);
    }
    return unavailable(503, context);
}
/** Closed Session Browser v3 adapter. The generated operation registry is the only route authority. */
export function createSiteSessionApi(input) {
    return Object.freeze({
        async handle(request, path) {
            let operationId;
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
                const session = await input.runtime.assemble(auth);
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
                return failure(error, { method: request.method, ...(operationId === undefined ? {} : { operationId }) });
            }
        },
    });
}
//# sourceMappingURL=session-api.js.map