import "server-only";
import { createSessionBrowserV3Proxy, type OpaqueAuthSession, type PublicSiteBootstrap, type SiteBootstrap, type SiteDeploymentBinding } from "@kokoro/bff-runtime";
import { type PublicCommandContext, type SecretPublicCommandContext, type PlatformPublicTransport } from "@kokoro/site-client/server";
import type { AccountProductsResponse, AssetUploadCommandResponse, AssetUploadIntentInput, AssetUploadIntentResponse, AssetUploadStatusResponse, CommandReceiptResponse, CreditSummaryResponse, EmailVerificationTransactionResponse, IdentitySessionList, PublicCommandReceiptResponse, ReauthenticationResponse, RecoveryCodeSetResponse, RedemptionCommandResponse, RedemptionPreviewResponse, TotpEnrollmentTransactionResponse, VerificationActivationResponse } from "@kokoro/site-client";
import type { NodeSiteRuntimeProvider } from "@kokoro/site-runtime-node";
import { type SiteMediaAuthority } from "./media-authority.js";
import { type SiteMemoryAuthority } from "./memory-api.js";
import { type SiteRequestBudget } from "./request-budget.js";
export { createLaunchStateVault } from "./launch-state.js";
export type { LaunchCommandState, LaunchOperation, LaunchStateBinding, LaunchStateVault, SecurityLaunchState } from "./launch-state.js";
export { createSiteLaunchApi, SITE_LAUNCH_STATE_COOKIE } from "./launch-api.js";
export type { SiteLaunchApi } from "./launch-api.js";
export { createSiteAssetApi } from "./asset-api.js";
export { createSiteMediaApi, type SiteMediaApi } from "./media-api.js";
export { createSiteMemoryApi, type SiteMemoryApi } from "./memory-api.js";
export type { SiteRequestBudget } from "./request-budget.js";
export { SiteArtifactAvailabilityError, type SiteMediaAuthority, type SiteMediaPageQuery, } from "./media-authority.js";
export { createSiteSessionApi, type SiteSessionApi, type SiteSessionApiRuntime } from "./session-api.js";
export type { BrowserAssetUpload, BrowserAttachmentRef, SiteAssetApi } from "./asset-api.js";
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
export type SiteReauthenticationTarget = Readonly<{
    audience: "platform-public";
    operationId: "beginTotpEnrollment" | "disableTotp" | "regenerateRecoveryCodes";
    resource: Readonly<{
        kind: "identity_account";
    }>;
}>;
export type SiteReauthenticationInput = Readonly<{
    stage: "password";
    password: string;
    target: SiteReauthenticationTarget;
}> | Readonly<{
    stage: "mfa";
    challengeKind: "totp" | "recovery";
    proofCode: string;
    transactionRef: string;
    target: SiteReauthenticationTarget;
}>;
/** A superseding delivery consumes the prior command and its recovery capability atomically. */
export declare function supersedeSiteDelivery(prior: SiteDeliveryAttempt, fresh: SiteOneTimeCommand): SiteDeliveryAttempt;
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
    reauthenticate(auth: OpaqueAuthSession, input: SiteReauthenticationInput, delivery: SiteDeliveryAttempt): Promise<ReauthenticationResponse>;
    beginTotpEnrollment(auth: OpaqueAuthSession, input: Readonly<{
        reauthenticationProof: string;
        priorTransactionRef?: string;
    }>, delivery: SiteDeliveryAttempt): Promise<TotpEnrollmentTransactionResponse>;
    confirmTotpEnrollment(auth: OpaqueAuthSession, input: Readonly<{
        transactionRef: string;
        code: string;
    }>, delivery: SiteDeliveryAttempt): Promise<RecoveryCodeSetResponse>;
    disableTotp(auth: OpaqueAuthSession, input: Readonly<{
        reauthenticationProof: string;
        code: string;
    }>, command: PublicCommandContext): Promise<CommandReceiptResponse>;
    regenerateRecoveryCodes(auth: OpaqueAuthSession, input: Readonly<{
        reauthenticationProof: string;
    }>, delivery: SiteDeliveryAttempt): Promise<RecoveryCodeSetResponse>;
    revokeSessions(auth: OpaqueAuthSession, input: Readonly<{
        target: "current" | "others" | "all";
    }>, command: PublicCommandContext): Promise<CommandReceiptResponse>;
    previewRedemption(auth: OpaqueAuthSession, code: string, command: PublicCommandContext): Promise<RedemptionPreviewResponse>;
    confirmRedemption(auth: OpaqueAuthSession, input: Readonly<{
        previewCredential: string;
        legalAcceptanceRefs: readonly string[];
    }>, command: PublicCommandContext): Promise<RedemptionCommandResponse>;
    recoverRedemption(auth: OpaqueAuthSession, idempotencyKey: string): Promise<RedemptionCommandResponse>;
    createAssetUploadIntent(auth: OpaqueAuthSession, input: AssetUploadIntentInput, command: PublicCommandContext): Promise<AssetUploadIntentResponse>;
    completeAssetUpload(auth: OpaqueAuthSession, intentRef: string, input: Readonly<{
        expectedVersion: string;
        sessionRef: string;
    }>, command: PublicCommandContext): Promise<AssetUploadCommandResponse>;
    getAssetUploadStatus(auth: OpaqueAuthSession, intentRef: string): Promise<AssetUploadStatusResponse>;
    recoverAssetUploadCommand(auth: OpaqueAuthSession, commandId: string): Promise<AssetUploadCommandResponse>;
    media(auth: OpaqueAuthSession, budget: SiteRequestBudget): Promise<SiteMediaAuthority>;
    memory(auth: OpaqueAuthSession, budget: SiteRequestBudget): Promise<SiteMemoryAuthority>;
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