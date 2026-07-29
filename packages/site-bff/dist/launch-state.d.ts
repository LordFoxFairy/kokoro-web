import "server-only";
import type { PublicCommandContext, SecretPublicCommandContext } from "@kokoro/site-client/server";
export type LaunchOperation = "identity.register" | "identity.verify-email" | "identity.resend-verification" | "identity.revoke-sessions" | "redemption.preview" | "redemption.confirm";
export interface LaunchCommandState {
    readonly operation: LaunchOperation;
    readonly flowRef: string;
    readonly command: PublicCommandContext | SecretPublicCommandContext;
    readonly createdAt: number;
    readonly lastUsedAt: number;
    readonly expiresAt: number;
    /** Stored only after preview succeeds; never serialized into RSC or browser JSON. */
    readonly preview?: Readonly<{
        previewCredential: string;
        legalAcceptanceRefs: readonly string[];
    }>;
}
export interface LaunchStateBinding {
    readonly siteProjectBindingRef: string;
    readonly deploymentRef: string;
    readonly siteReleaseRef: string;
    readonly webArtifactDigest: string;
}
export declare function createLaunchStateVault(input: Readonly<{
    secret: string;
    binding: LaunchStateBinding;
    now?: () => number;
    nonce?: () => Buffer;
}>): Readonly<{
    clean: (entries: readonly LaunchCommandState[]) => readonly LaunchCommandState[];
    seal: (entries: readonly LaunchCommandState[]) => string;
    open: (sealed: string | null | undefined) => readonly LaunchCommandState[];
    put: (entries: readonly LaunchCommandState[], entry: LaunchCommandState) => readonly LaunchCommandState[];
    find: (entries: readonly LaunchCommandState[], operation: LaunchOperation, flowRef: string) => LaunchCommandState | undefined;
}>;
export type LaunchStateVault = ReturnType<typeof createLaunchStateVault>;
//# sourceMappingURL=launch-state.d.ts.map