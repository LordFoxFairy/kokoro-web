import "server-only";
import { createSessionBrowserV3Proxy, type OpaqueAuthSession, type PublicSiteBootstrap, type SiteBootstrap, type SiteDeploymentBinding } from "@kokoro/bff-runtime";
import { type PublicCommandContext, type SecretPublicCommandContext, type PlatformPublicTransport } from "@kokoro/site-client/server";
import type { AccountProductsResponse, CommandReceiptResponse, CreditSummaryResponse, EmailVerificationTransactionResponse, IdentitySessionList, PublicCommandReceiptResponse, RedemptionCommandResponse, RedemptionPreviewResponse, VerificationActivationResponse } from "@kokoro/site-client";
import type { NodeSiteRuntimeProvider } from "@kokoro/site-runtime-node";
export { createLaunchStateVault } from "./launch-state.js";
export type { LaunchCommandState, LaunchOperation, LaunchStateBinding, LaunchStateVault } from "./launch-state.js";
export { createSiteLaunchApi, SITE_LAUNCH_STATE_COOKIE } from "./launch-api.js";
export type { SiteLaunchApi } from "./launch-api.js";
export declare class SiteBffError extends Error {
    readonly code: "CONFIG_INVALID" | "AUTH_REJECTED" | "AUTH_MFA_REQUIRED" | "AUTH_DELIVERY_UNAVAILABLE";
    constructor(code: "CONFIG_INVALID" | "AUTH_REJECTED" | "AUTH_MFA_REQUIRED" | "AUTH_DELIVERY_UNAVAILABLE");
}
export type SiteCredentialPair = Readonly<{
    sessionRef: string;
    sessionCredential: string;
    sessionCredentialExpiresAt: string;
    refreshCredential: string;
    refreshCredentialExpiresAt: string;
}>;
export type SiteLoginResult = Readonly<{
    kind: "authenticated";
    credentials: SiteCredentialPair;
}> | Readonly<{
    kind: "mfa_required";
    transactionRef: string;
    challengeKind: "totp" | "recovery";
    expiresAt: string;
}>;
export type SiteOneTimeCommand = Readonly<SecretPublicCommandContext>;
export type SiteDeliveryAttempt = Readonly<{
    command: SiteOneTimeCommand;
    priorCommandId?: string;
}>;
export type SiteSessionRuntime = Readonly<{
    authSession: Readonly<import("@kokoro/bff-runtime").AuthSession>;
    bootstrap: SiteBootstrap;
    publicBootstrap: Readonly<PublicSiteBootstrap>;
    proxy: ReturnType<typeof createSessionBrowserV3Proxy>;
}>;
export interface SiteBffRuntime {
    readonly publicOrigin: string;
    readonly deploymentIdentity: Readonly<{
        deploymentRef: string;
        webArtifactDigest: string;
        publicOrigin: string;
    }>;
    readonly bindingIdentity: Readonly<{
        siteProjectBindingRef: string;
        siteReleaseRef: string;
    }>;
    issueBrowserCsrf(): string;
    verifyBrowserMutation(input: Readonly<{
        operationId: string;
        token: string;
    }>): boolean;
    createCommand(): PublicCommandContext;
    createOneTimeCommand(): SiteOneTimeCommand;
    publicCapabilities(): Promise<Readonly<{
        enabledSurfaceIds: readonly string[];
        featurePolicyRevision: string;
    }>>;
    register(input: Readonly<{
        email: string;
        password: string;
        legalAcceptanceRefs: readonly string[];
    }>, command: PublicCommandContext): Promise<EmailVerificationTransactionResponse>;
    resendVerification(email: string, command: PublicCommandContext): Promise<EmailVerificationTransactionResponse>;
    completeEmailVerification(input: Readonly<{
        transactionRef: string;
        transactionSecret: string;
    }>, delivery: SiteDeliveryAttempt): Promise<VerificationActivationResponse>;
    listSecuritySessions(auth: OpaqueAuthSession): Promise<IdentitySessionList>;
    revokeSessions(auth: OpaqueAuthSession, input: Readonly<{
        target: "current" | "others" | "all";
    }>, command: PublicCommandContext): Promise<CommandReceiptResponse>;
    previewRedemption(auth: OpaqueAuthSession, code: string, command: PublicCommandContext): Promise<RedemptionPreviewResponse>;
    confirmRedemption(auth: OpaqueAuthSession, input: Readonly<{
        previewCredential: string;
        legalAcceptanceRefs: readonly string[];
    }>, command: PublicCommandContext): Promise<RedemptionCommandResponse>;
    recoverRedemption(auth: OpaqueAuthSession, idempotencyKey: string): Promise<RedemptionCommandResponse>;
    accountProducts(auth: OpaqueAuthSession): Promise<AccountProductsResponse>;
    creditSummary(auth: OpaqueAuthSession): Promise<CreditSummaryResponse>;
    commandReceipt(auth: OpaqueAuthSession | null, commandId: string, receiptRecoveryCapability?: string): Promise<PublicCommandReceiptResponse>;
    login(input: Readonly<{
        email: string;
        password: string;
    }>, delivery: SiteDeliveryAttempt): Promise<SiteLoginResult>;
    completeMfa(input: Readonly<{
        transactionRef: string;
        code: string;
    }>, delivery: SiteDeliveryAttempt): Promise<SiteCredentialPair>;
    refresh(refreshCredential: string, delivery: SiteDeliveryAttempt): Promise<SiteCredentialPair>;
    revoke(auth: OpaqueAuthSession): Promise<void>;
    assemble(auth: OpaqueAuthSession): Promise<SiteSessionRuntime>;
}
export declare function loadSiteBffDeployment(env?: NodeJS.ProcessEnv): Readonly<{
    binding: SiteDeploymentBinding;
    publicOrigin: string;
}>;
/** One immutable Site composition root. No request field can replace binding, origin, or provider. */
export declare function createSiteBffRuntime(input: Readonly<{
    binding: SiteDeploymentBinding;
    publicOrigin: string;
    provider: NodeSiteRuntimeProvider;
}>): SiteBffRuntime;
export type { OpaqueAuthSession } from "@kokoro/bff-runtime";
export type { PlatformPublicTransport };
//# sourceMappingURL=index.d.ts.map