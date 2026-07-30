import "server-only";
import { type OpaqueAuthSession } from "@kokoro/bff-runtime";
import type { SiteBffRuntime } from "./index.js";
export type SiteSessionApiRuntime = Pick<SiteBffRuntime, "assemble" | "publicOrigin">;
export interface SiteSessionApi {
    handle(request: Request, path: readonly string[]): Promise<Response>;
}
/** Closed Session Browser v3 adapter. The generated operation registry is the only route authority. */
export declare function createSiteSessionApi(input: Readonly<{
    runtime: SiteSessionApiRuntime;
    readAuthSession(): Promise<OpaqueAuthSession | null> | OpaqueAuthSession | null;
}>): SiteSessionApi;
//# sourceMappingURL=session-api.d.ts.map