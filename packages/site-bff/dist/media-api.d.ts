import "server-only";
import type { OpaqueAuthSession } from "@kokoro/bff-runtime";
import type { SiteBffRuntime } from "./index.js";
import type { SiteRequestBudget } from "./request-budget.js";
export interface SiteMediaApi {
    handle(request: Request, path: readonly string[]): Promise<Response>;
}
/** Exact Site media/artifact composition. This is deliberately not a generic Platform proxy. */
export declare function createSiteMediaApi(input: Readonly<{
    runtime: SiteBffRuntime;
    readAuthSession(budget: SiteRequestBudget): Promise<OpaqueAuthSession | null> | OpaqueAuthSession | null;
    monotonicNow?: () => number;
}>): SiteMediaApi;
//# sourceMappingURL=media-api.d.ts.map