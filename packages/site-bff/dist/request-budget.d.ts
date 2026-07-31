export interface SiteRequestBudget {
    readonly signal: AbortSignal;
    remainingDeadlineMs(): number;
}
/** Bounds caller waiting while the same signal/deadline is propagated into each upstream transport. */
export declare function waitWithinBudget<Value>(promise: Promise<Value>, budget: SiteRequestBudget): Promise<Value>;
//# sourceMappingURL=request-budget.d.ts.map