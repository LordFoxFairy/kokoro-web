import "server-only";
import { createSessionBrowserV3Proxy, type OpaqueAuthSession, type PublicSiteBootstrap, type SiteBootstrap, type SiteDeploymentBinding } from "@kokoro/bff-runtime";
import { type SecretPublicCommandContext, type PlatformPublicTransport } from "@kokoro/site-client/server";
import type { NodeSiteRuntimeProvider } from "@kokoro/site-runtime-node";
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
export declare function loadSiteBffDeployment(env?: NodeJS.ProcessEnv): Readonly<{
    binding: SiteDeploymentBinding;
    publicOrigin: string;
}>;
/** One immutable Site composition root. No request field can replace binding, origin, or provider. */
export declare function createSiteBffRuntime(input: Readonly<{
    binding: SiteDeploymentBinding;
    publicOrigin: string;
    provider: NodeSiteRuntimeProvider;
}>): Readonly<{
    publicOrigin: string;
    deploymentIdentity: Readonly<{
        deploymentRef: string;
        webArtifactDigest: string;
        publicOrigin: string;
    }>;
    issueBrowserCsrf: () => string;
    createOneTimeCommand: () => Readonly<SecretPublicCommandContext>;
    login(loginInput: Readonly<{
        email: string;
        password: string;
    }>, delivery: SiteDeliveryAttempt): Promise<SiteLoginResult>;
    completeMfa(mfa: Readonly<{
        transactionRef: string;
        code: string;
    }>, delivery: SiteDeliveryAttempt): Promise<SiteCredentialPair>;
    refresh(refreshCredential: string, delivery: SiteDeliveryAttempt): Promise<SiteCredentialPair>;
    revoke(authSession: OpaqueAuthSession): Promise<void>;
    assemble(authSession: OpaqueAuthSession): Promise<SiteSessionRuntime>;
}>;
export type SiteBffRuntime = ReturnType<typeof createSiteBffRuntime>;
export type { OpaqueAuthSession } from "@kokoro/bff-runtime";
export type { PlatformPublicTransport };
//# sourceMappingURL=index.d.ts.map