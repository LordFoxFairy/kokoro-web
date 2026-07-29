import "server-only";
import { randomUUID } from "node:crypto";
import { bootstrapSiteRuntimeFromOpaqueSession, createOriginCsrfBrowserRequestVerifier, createSessionBrowserV3Proxy, createSessionBrowserV3Transport, loadSiteDeploymentBinding, ProductContextManager, SessionAccessManager, publicSiteBootstrap, } from "@kokoro/bff-runtime";
import { createPlatformPublicClient, } from "@kokoro/site-client/server";
export { createLaunchStateVault } from "./launch-state.js";
export { createSiteLaunchApi, SITE_LAUNCH_STATE_COOKIE } from "./launch-api.js";
export class SiteBffError extends Error {
    code;
    constructor(code) {
        super(`Site BFF rejected: ${code}`);
        this.code = code;
        this.name = "SiteBffError";
    }
}
/** A superseding delivery consumes the prior command and its recovery capability atomically. */
export function supersedeSiteDelivery(prior, fresh) {
    return Object.freeze({
        command: Object.freeze({
            ...fresh,
            receiptRecoveryCapability: prior.command.receiptRecoveryCapability,
        }),
        priorCommandId: prior.command.commandId,
    });
}
function required(env, name) {
    const value = env[name]?.trim();
    if (!value)
        throw new SiteBffError("CONFIG_INVALID");
    return value;
}
function fixedOrigin(value) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new SiteBffError("CONFIG_INVALID");
    }
    if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.username !== "" || parsed.password !== "" ||
        parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "")
        throw new SiteBffError("CONFIG_INVALID");
    return parsed.origin;
}
export function loadSiteBffDeployment(env = process.env) {
    const runtimeEnvironment = required(env, "KOKORO_SITE_RUNTIME_ENVIRONMENT");
    if (runtimeEnvironment !== "development" && runtimeEnvironment !== "preview" && runtimeEnvironment !== "production") {
        throw new SiteBffError("CONFIG_INVALID");
    }
    return Object.freeze({
        publicOrigin: fixedOrigin(required(env, "KOKORO_SITE_PUBLIC_ORIGIN")),
        binding: loadSiteDeploymentBinding({
            runtimeEnvironment,
            siteProjectBindingRef: required(env, "KOKORO_SITE_PROJECT_BINDING_REF"),
            deploymentRef: required(env, "KOKORO_SITE_DEPLOYMENT_REF"),
            siteReleaseRef: required(env, "KOKORO_SITE_RELEASE_REF"),
            webArtifactDigest: required(env, "KOKORO_WEB_ARTIFACT_DIGEST"),
            workloadCredential: required(env, "KOKORO_PLATFORM_WORKLOAD_CREDENTIAL"),
            sessionContractRevision: required(env, "KOKORO_SESSION_CONTRACT_REVISION"),
            region: required(env, "KOKORO_SITE_REGION"),
            productAudience: required(env, "KOKORO_PRODUCT_AUDIENCE"),
        }),
    });
}
function credentials(response) {
    if (typeof response !== "object" || response === null) {
        throw new SiteBffError("AUTH_REJECTED");
    }
    if ("kind" in response && response.kind === "delivery_unavailable") {
        throw new SiteBffError("AUTH_DELIVERY_UNAVAILABLE");
    }
    if (!("credentials" in response))
        throw new SiteBffError("AUTH_REJECTED");
    const value = response.credentials;
    if (typeof value !== "object" || value === null)
        throw new SiteBffError("AUTH_REJECTED");
    const candidate = value;
    for (const name of [
        "sessionRef",
        "sessionCredential",
        "sessionCredentialExpiresAt",
        "refreshCredential",
        "refreshCredentialExpiresAt",
    ]) {
        if (typeof candidate[name] !== "string")
            throw new SiteBffError("AUTH_REJECTED");
    }
    return Object.freeze(candidate);
}
function command(client) {
    return client.createCommand();
}
function oneTimeCommand(client) {
    return client.createSecretCommand();
}
/** One immutable Site composition root. No request field can replace binding, origin, or provider. */
export function createSiteBffRuntime(input) {
    const publicOrigin = fixedOrigin(input.publicOrigin);
    const anonymousPlatform = createPlatformPublicClient({
        transport: input.provider.platformTransport({ binding: input.binding }),
        csrfToken: () => input.provider.platformCsrfToken(),
    });
    const productContexts = new ProductContextManager({
        binding: input.binding,
        commandFactory: { create: () => ({ commandRef: randomUUID(), ...command(anonymousPlatform) }) },
        authority: {
            exchangeProductContext: ({ commandRef, command: commandIdentity }) => anonymousPlatform.execute({
                operationId: "exchangeProductContext",
                data: { body: { commandRef } },
                command: commandIdentity,
            }),
        },
    });
    const authenticatedClient = (authSession) => createPlatformPublicClient({
        transport: input.provider.platformTransport({ binding: input.binding, authSession }),
        csrfToken: () => input.provider.platformCsrfToken(),
    });
    return Object.freeze({
        publicOrigin,
        deploymentIdentity: Object.freeze({
            deploymentRef: input.binding.deploymentRef,
            webArtifactDigest: input.binding.webArtifactDigest,
            publicOrigin,
        }),
        bindingIdentity: Object.freeze({
            siteProjectBindingRef: input.binding.siteProjectBindingRef,
            siteReleaseRef: input.binding.siteReleaseRef,
        }),
        issueBrowserCsrf: () => input.provider.issueBrowserCsrf(),
        verifyBrowserMutation: (verification) => input.provider.verifyBrowserCsrf(verification),
        createCommand: () => command(anonymousPlatform),
        createOneTimeCommand: () => oneTimeCommand(anonymousPlatform),
        async publicCapabilities() {
            const context = await productContexts.acquire();
            return Object.freeze({
                enabledSurfaceIds: Object.freeze([...context.enabledSurfaceIds]),
                featurePolicyRevision: context.featurePolicyRevision,
            });
        },
        register(registration, commandIdentity) {
            return anonymousPlatform.execute({
                operationId: "beginRegistration",
                data: { body: {
                        email: registration.email.trim().toLowerCase(),
                        password: registration.password,
                        legalAcceptanceRefs: [...registration.legalAcceptanceRefs],
                    } },
                command: commandIdentity,
            });
        },
        resendVerification(email, commandIdentity) {
            return anonymousPlatform.execute({
                operationId: "resendEmailVerification",
                data: { body: { email: email.trim().toLowerCase() } },
                command: commandIdentity,
            });
        },
        completeEmailVerification(verification, delivery) {
            return anonymousPlatform.execute({
                operationId: "completeEmailVerification",
                data: { path: { id: verification.transactionRef }, body: { transactionSecret: verification.transactionSecret } },
                command: delivery.command,
            });
        },
        listSecuritySessions(authSession) {
            return authenticatedClient(authSession).execute({ operationId: "listIdentitySessions", data: {} });
        },
        revokeSessions(authSession, revoke, commandIdentity) {
            return authenticatedClient(authSession).execute({
                operationId: "revokeIdentitySessions",
                data: { body: revoke },
                command: commandIdentity,
            });
        },
        previewRedemption(authSession, code, commandIdentity) {
            return authenticatedClient(authSession).execute({
                operationId: "previewRedemption",
                data: { body: { code } },
                command: commandIdentity,
            });
        },
        confirmRedemption(authSession, redemption, commandIdentity) {
            return authenticatedClient(authSession).execute({
                operationId: "confirmRedemption",
                data: { body: {
                        previewCredential: redemption.previewCredential,
                        legalAcceptanceRefs: [...redemption.legalAcceptanceRefs],
                    } },
                command: commandIdentity,
            });
        },
        recoverRedemption(authSession, idempotencyKey) {
            return authenticatedClient(authSession).execute({
                operationId: "recoverRedemptionCommand",
                data: {},
                idempotencyKey,
            });
        },
        accountProducts(authSession) {
            return authenticatedClient(authSession).execute({ operationId: "listAccountProducts", data: {} });
        },
        creditSummary(authSession) {
            return authenticatedClient(authSession).execute({ operationId: "getCreditSummary", data: {} });
        },
        commandReceipt(authSession, commandId, receiptRecoveryCapability) {
            const platform = authSession === null ? anonymousPlatform : authenticatedClient(authSession);
            return platform.execute({
                operationId: "getPublicCommandReceipt",
                data: { path: { id: commandId } },
                ...(receiptRecoveryCapability === undefined ? {} : { receiptRecoveryCapability }),
            });
        },
        async login(loginInput, delivery) {
            const response = await anonymousPlatform.execute({
                operationId: "createIdentitySession",
                data: { body: delivery.priorCommandId === undefined
                        ? { email: loginInput.email.trim().toLowerCase(), password: loginInput.password }
                        : { priorCommandId: delivery.priorCommandId, recoveryAction: "supersede_session_delivery" } },
                command: delivery.command,
            });
            if ("pending" in response) {
                return Object.freeze({ kind: "mfa_required", ...response.pending });
            }
            return Object.freeze({ kind: "authenticated", credentials: credentials(response) });
        },
        async completeMfa(mfa, delivery) {
            const response = await anonymousPlatform.execute({
                operationId: "completeSessionMfa",
                data: {
                    path: { id: mfa.transactionRef },
                    body: delivery.priorCommandId === undefined
                        ? { code: mfa.code }
                        : { priorCommandId: delivery.priorCommandId, recoveryAction: "supersede_session_delivery" },
                },
                command: delivery.command,
            });
            return credentials(response);
        },
        async refresh(refreshCredential, delivery) {
            const response = await anonymousPlatform.execute({
                operationId: "refreshIdentitySession",
                data: { body: delivery.priorCommandId === undefined
                        ? { opaqueCredential: refreshCredential }
                        : { priorCommandId: delivery.priorCommandId, recoveryAction: "supersede_refresh_delivery" } },
                command: delivery.command,
            });
            return credentials(response);
        },
        async revoke(authSession) {
            const platform = authenticatedClient(authSession);
            await platform.execute({
                operationId: "revokeIdentitySessions",
                data: { body: { target: "current" } },
                command: command(platform),
            });
        },
        async assemble(authSession) {
            const platform = authenticatedClient(authSession);
            const resolved = await bootstrapSiteRuntimeFromOpaqueSession({
                productContexts,
                authSession,
                personalAuthority: {
                    getPersonalContext: () => platform.execute({ operationId: "getPersonalContext", data: {} }),
                },
            });
            const access = new SessionAccessManager({
                bootstrap: resolved.bootstrap,
                authSession: resolved.authSession,
                authority: {
                    issueSessionAccessGrant: ({ productContextRef, projectRef, purpose, resource }) => platform.execute({
                        operationId: "issueSessionAccessGrant",
                        data: { body: { productContextRef, projectRef, purpose, resource } },
                    }),
                },
            });
            return Object.freeze({
                ...resolved,
                publicBootstrap: publicSiteBootstrap(resolved.bootstrap),
                proxy: createSessionBrowserV3Proxy({
                    bootstrap: resolved.bootstrap,
                    access,
                    transport: createSessionBrowserV3Transport(input.provider.sessionHttp({ binding: input.binding })),
                    browserRequestVerifier: createOriginCsrfBrowserRequestVerifier({
                        runtimeEnvironment: input.binding.runtimeEnvironment,
                        allowedOrigins: [publicOrigin],
                        csrf: { verify: (request) => input.provider.verifyBrowserCsrf(request) },
                    }),
                }),
            });
        },
    });
}
//# sourceMappingURL=index.js.map