import "server-only";
import type { PublicCommandContext, SecretPublicCommandContext } from "@kokoro/site-client/server";
export type LaunchOperation = "identity.register" | "identity.verify-email" | "identity.resend-verification" | "identity.revoke-sessions" | "identity.enroll-totp" | "identity.disable-totp" | "identity.regenerate-recovery-codes" | "redemption.preview" | "redemption.confirm";
export type SecurityLaunchState = Readonly<{
    phase: "reauthenticate_password";
    supersedePriorCommandId?: string;
}> | Readonly<{
    phase: "reauthenticate_mfa";
    challengeKind: "totp" | "recovery";
    transactionRef: string;
    supersedePriorCommandId?: string;
}> | Readonly<{
    phase: "totp_enrollment_delivery";
    reauthenticationProof: string;
    supersedePriorCommandId?: string;
    priorTransactionRef?: string;
}> | Readonly<{
    phase: "recovery_code_delivery";
    reauthenticationProof: string;
    supersedePriorCommandId?: string;
}> | Readonly<{
    phase: "totp_confirmation";
    transactionRef: string;
}> | Readonly<{
    phase: "disable_confirmation";
    reauthenticationProof: string;
}>;
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
    /** Sensitive ceremony state is encrypted into the HttpOnly Site cookie and never exposed to browser code. */
    readonly security?: SecurityLaunchState;
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