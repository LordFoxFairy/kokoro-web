import "server-only";
import type { OpaqueAuthSession } from "@kokoro/bff-runtime";
import type { SiteBffRuntime } from "./index.js";
export declare const SITE_LAUNCH_STATE_COOKIE = "__Host-kokoro.launch-state";
type LaunchAction = "dashboard" | "prepare" | "execute" | "recover";
export declare function createSiteLaunchApi(input: Readonly<{
    runtime: SiteBffRuntime;
    stateSecret: string;
    readAuthSession(request: Request): Promise<OpaqueAuthSession | null> | OpaqueAuthSession | null;
    registrationLegalAcceptanceRefs?: readonly string[];
    now?: () => number;
    nonce?: () => Buffer;
}>): Readonly<{
    handle: (request: Request, action: LaunchAction) => Promise<Response>;
}>;
export type SiteLaunchApi = ReturnType<typeof createSiteLaunchApi>;
export {};
//# sourceMappingURL=launch-api.d.ts.map