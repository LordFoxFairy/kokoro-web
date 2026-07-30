import "server-only";
import type { OpaqueAuthSession } from "@kokoro/bff-runtime";
import type { AssetUploadStatus } from "@kokoro/site-client";
import type { SiteBffRuntime } from "./index.js";
export type BrowserAttachmentRef = Readonly<{
    asset_ref: string;
    asset_version_ref: string;
    asset_grant_ref: string;
}>;
export type BrowserAssetUpload = Readonly<{
    intentRef: string;
    sessionRef: string;
    expectedVersion: string;
    expectedSize: string;
    clientMediaType: string;
    purpose: string;
    safeDisplayName: string;
    stage: AssetUploadStatus["stage"];
    terminal: boolean;
    retryClass: AssetUploadStatus["retryClass"];
    retryAfter: string | null;
    safeReasonCode: string | null;
    attachment: BrowserAttachmentRef | null;
}>;
export interface SiteAssetApi {
    handle(request: Request, path: readonly string[]): Promise<Response>;
}
/** Browser control plane for Asset owner operations. It is an allowlisted composition, never a generic Platform proxy. */
export declare function createSiteAssetApi(input: Readonly<{
    runtime: SiteBffRuntime;
    readAuthSession(): Promise<OpaqueAuthSession | null> | OpaqueAuthSession | null;
}>): SiteAssetApi;
//# sourceMappingURL=asset-api.d.ts.map