import "server-only";
import type { OpaqueAuthSession } from "@kokoro/bff-runtime";
import type { MemoryCategory, MemoryCommandResponse, MemoryCorrectInput, MemoryEntryHistoryPage, MemoryEntryPage, MemoryEntryResponse, MemoryExportInput, MemoryExportResponse, MemoryForgetInput, MemoryImportInput, MemoryImportResponse, MemoryPriorityInput, MemoryRememberInput, MemoryResetInput, MemoryRestoreInput, MemorySettings, MemorySettingsUpdateInput, MemorySourceKind } from "@kokoro/site-client";
import { type PublicCommandContext, type createPlatformPublicClient } from "@kokoro/site-client/server";
import { type SiteRequestBudget } from "./request-budget.js";
type PlatformClient = ReturnType<typeof createPlatformPublicClient>;
export type SiteMemoryPageQuery = Readonly<{
    category?: MemoryCategory;
    source?: MemorySourceKind;
    cursor?: string;
    limit?: number;
}>;
export type SiteMemoryHistoryQuery = Readonly<{
    cursor?: string;
    limit?: number;
}>;
export type SiteMemoryRequestOptions = Readonly<{
    signal: AbortSignal;
    deadlineMs: number;
}>;
export interface SiteMemoryAuthority {
    getSettings(options: SiteMemoryRequestOptions): Promise<MemorySettings>;
    updateSettings(input: MemorySettingsUpdateInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>;
    listEntries(query: SiteMemoryPageQuery, options: SiteMemoryRequestOptions): Promise<MemoryEntryPage>;
    remember(input: MemoryRememberInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>;
    getEntry(entryRef: string, options: SiteMemoryRequestOptions): Promise<MemoryEntryResponse>;
    listHistory(entryRef: string, query: SiteMemoryHistoryQuery, options: SiteMemoryRequestOptions): Promise<MemoryEntryHistoryPage>;
    restore(entryRef: string, revisionRef: string, input: MemoryRestoreInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>;
    correct(entryRef: string, input: MemoryCorrectInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>;
    prioritize(entryRef: string, input: MemoryPriorityInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>;
    deprioritize(entryRef: string, input: MemoryPriorityInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>;
    forget(entryRef: string, input: MemoryForgetInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>;
    reset(input: MemoryResetInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>;
    requestExport(input: MemoryExportInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>;
    getExport(exportRef: string, options: SiteMemoryRequestOptions): Promise<MemoryExportResponse>;
    requestImport(input: MemoryImportInput, command: PublicCommandContext, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>;
    getImport(importRef: string, options: SiteMemoryRequestOptions): Promise<MemoryImportResponse>;
    recoverCommand(commandId: string, options: SiteMemoryRequestOptions): Promise<MemoryCommandResponse>;
}
export interface SiteMemoryApiRuntime {
    readonly publicOrigin: string;
    verifyBrowserMutation(input: Readonly<{
        operationId: string;
        token: string;
    }>): boolean;
    memory(auth: OpaqueAuthSession, budget: SiteRequestBudget): Promise<SiteMemoryAuthority | null>;
}
export interface SiteMemoryApi {
    handle(request: Request, path: readonly string[]): Promise<Response>;
}
/** Server-resolved Memory authority. Site, subject, Project, space and namespace never enter this port. */
export declare function createSiteMemoryAuthority(input: Readonly<{
    platform: PlatformClient;
}>): SiteMemoryAuthority;
/** Exact same-origin Memory composition. It is deliberately not a generic Platform proxy. */
export declare function createSiteMemoryApi(input: Readonly<{
    runtime: SiteMemoryApiRuntime;
    readAuthSession(budget: SiteRequestBudget): Promise<OpaqueAuthSession | null> | OpaqueAuthSession | null;
    monotonicNow?: () => number;
}>): SiteMemoryApi;
export {};
//# sourceMappingURL=memory-api.d.ts.map