/** Bounds caller waiting while the same signal/deadline is propagated into each upstream transport. */
export function waitWithinBudget(promise, budget) {
    const timeoutMs = budget.remainingDeadlineMs();
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (run) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            budget.signal.removeEventListener("abort", abort);
            run();
        };
        const abort = () => finish(() => reject(budget.signal.reason ?? new Error("Site request aborted")));
        const timer = setTimeout(() => finish(() => reject(new Error("Site request deadline exhausted"))), timeoutMs);
        timer.unref();
        budget.signal.addEventListener("abort", abort, { once: true });
        if (budget.signal.aborted)
            abort();
        promise.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
    });
}
//# sourceMappingURL=request-budget.js.map