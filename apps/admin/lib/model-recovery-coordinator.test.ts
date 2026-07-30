import { describe, expect, it, vi } from "vitest";
import {
  INITIAL_MODEL_RECOVERY_STATE,
  MODEL_RECOVERY_STORAGE_KEY,
  compareAndRemoveModelRecovery,
  createModelRecoveryStateAuthority,
  getModelRecoveryStateAuthorityForDocument,
  modelRecoveryStateFromStorageEvent,
  readAvailableModelRecoveryState,
  readModelRecoveryState,
  reconcileModelRecoveryUnderLock,
  runModelMutationUnderLock,
  type ModelRecoveryLockManager,
  type ModelRecoveryStorage,
} from "./model-recovery-coordinator";

class MemoryStorage implements ModelRecoveryStorage {
  readonly values = new Map<string, string>();
  removeCalls = 0;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.removeCalls += 1; this.values.delete(key); }
}

class SerialLocks implements ModelRecoveryLockManager {
  private tail: Promise<void> = Promise.resolve();
  request<T>(_name: string, _options: Readonly<{ mode: "exclusive" }>, callback: () => Promise<T>): Promise<T> {
    const result = this.tail.then(callback);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise; reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("model recovery coordinator", () => {
  it("starts fail-closed and never deletes, exposes, or overwrites a corrupt stored value", async () => {
    const storage = new MemoryStorage();
    const corrupt = "secret:" + "x".repeat(4_096);
    const prepare = vi.fn(async () => ({ recoveryRef: "replacement" }));
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, corrupt);

    expect(INITIAL_MODEL_RECOVERY_STATE).toEqual({ kind: "initializing" });
    const state = readModelRecoveryState(storage);

    expect(state).toEqual({ kind: "corrupt" });
    expect(JSON.stringify(state)).not.toContain(corrupt);
    await expect(runModelMutationUnderLock({
      storage, locks: new SerialLocks(), prepare, execute: vi.fn(), onState: vi.fn(),
      authority: createModelRecoveryStateAuthority(),
    })).resolves.toEqual({ kind: "blocked", state: { kind: "corrupt" } });
    expect(prepare).not.toHaveBeenCalled();
    expect(storage.getItem(MODEL_RECOVERY_STORAGE_KEY)).toBe(corrupt);
  });

  it("fails closed without Web Locks and never prepares", async () => {
    const storage = new MemoryStorage();
    const prepare = vi.fn();

    const result = await runModelMutationUnderLock({
      storage, locks: null, prepare, execute: vi.fn(), onState: vi.fn(),
      authority: createModelRecoveryStateAuthority(),
    });

    expect(result).toEqual({ kind: "blocked", state: { kind: "unavailable", reason: "locks" } });
    expect(prepare).not.toHaveBeenCalled();
    expect(readAvailableModelRecoveryState(storage, null)).toEqual({ kind: "unavailable", reason: "locks" });
  });

  it("allows only one pending mutation across two tabs and rereads storage inside the lock", async () => {
    const storage = new MemoryStorage();
    const locks = new SerialLocks();
    const firstEffect = deferred<void>();
    const firstPrepare = vi.fn(async () => ({ recoveryRef: "tab_one" }));
    const secondPrepare = vi.fn(async () => ({ recoveryRef: "tab_two" }));

    const first = runModelMutationUnderLock({
      storage, locks, prepare: firstPrepare, execute: () => firstEffect.promise, onState: vi.fn(),
      authority: createModelRecoveryStateAuthority(),
    });
    await vi.waitFor(() => expect(storage.getItem(MODEL_RECOVERY_STORAGE_KEY)).toBe("tab_one"));
    const second = runModelMutationUnderLock({
      storage, locks, prepare: secondPrepare, execute: vi.fn(), onState: vi.fn(),
      authority: createModelRecoveryStateAuthority(),
    });
    firstEffect.reject(new Error("outcome_unknown"));

    await expect(first).rejects.toThrow("outcome_unknown");
    await expect(second).resolves.toEqual({
      kind: "blocked", state: { kind: "pending", recoveryRef: "tab_one" },
    });
    expect(firstPrepare).toHaveBeenCalledOnce();
    expect(secondPrepare).not.toHaveBeenCalled();
    expect(storage.getItem(MODEL_RECOVERY_STORAGE_KEY)).toBe("tab_one");
  });

  it("does not overwrite corruption observed while prepare is in flight", async () => {
    const storage = new MemoryStorage();
    const authority = createModelRecoveryStateAuthority();
    const locks = new SerialLocks();
    const prepared = deferred<Readonly<{ recoveryRef: string }>>();
    const prepare = vi.fn(() => prepared.promise);
    const execute = vi.fn();
    const mutation = runModelMutationUnderLock({
      storage,
      locks,
      prepare,
      execute,
      onState: vi.fn(),
      authority,
    });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    const corrupt = "corrupt:" + "x".repeat(2_048);
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, corrupt);
    expect(modelRecoveryStateFromStorageEvent({
      key: MODEL_RECOVERY_STORAGE_KEY, storageArea: storage,
    }, storage, locks, authority)).toEqual({ kind: "corrupt" });

    prepared.resolve({ recoveryRef: "must_not_replace_corrupt" });

    await expect(mutation).resolves.toEqual({ kind: "blocked", state: { kind: "corrupt" } });
    expect(storage.getItem(MODEL_RECOVERY_STORAGE_KEY)).toBe(corrupt);
    expect(execute).not.toHaveBeenCalled();
  });

  it("compare-and-remove never deletes a recovery ref owned by another tab", () => {
    const storage = new MemoryStorage();
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, "other_tab");

    expect(compareAndRemoveModelRecovery(storage, "this_tab")).toEqual({
      kind: "pending", recoveryRef: "other_tab",
    });
    expect(storage.getItem(MODEL_RECOVERY_STORAGE_KEY)).toBe("other_tab");
  });

  it("synchronizes another tab from authoritative storage events instead of trusting event payloads", () => {
    const storage = new MemoryStorage();
    const locks = new SerialLocks();
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, "authoritative_ref");

    expect(modelRecoveryStateFromStorageEvent({
      key: MODEL_RECOVERY_STORAGE_KEY, storageArea: storage,
    }, storage, locks, createModelRecoveryStateAuthority())).toEqual({
      kind: "pending", recoveryRef: "authoritative_ref",
    });
    expect(modelRecoveryStateFromStorageEvent({
      key: "unrelated", storageArea: storage,
    }, storage, locks, createModelRecoveryStateAuthority())).toBeNull();
  });

  it("keeps observed corruption sticky when another tab clears storage", async () => {
    const storage = new MemoryStorage();
    const locks = new SerialLocks();
    const authority = createModelRecoveryStateAuthority();
    const corrupt = "broken:" + "x".repeat(2_048);
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, corrupt);
    const observed = authority.observe(readModelRecoveryState(storage));
    expect(observed).toEqual({ kind: "corrupt" });

    storage.removeItem(MODEL_RECOVERY_STORAGE_KEY);
    const afterClearEvent = modelRecoveryStateFromStorageEvent({
      key: null, storageArea: storage,
    }, storage, locks, authority);

    expect(afterClearEvent).toEqual({ kind: "corrupt" });
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, "plausible_ref");
    expect(modelRecoveryStateFromStorageEvent({
      key: MODEL_RECOVERY_STORAGE_KEY, storageArea: storage,
    }, storage, locks, authority)).toEqual({ kind: "corrupt" });
    storage.removeItem(MODEL_RECOVERY_STORAGE_KEY);
    expect(modelRecoveryStateFromStorageEvent({
      key: null, storageArea: storage,
    }, storage, locks, authority)).toEqual({ kind: "corrupt" });

    const prepare = vi.fn(async () => ({ recoveryRef: "must_not_prepare" }));
    await runModelMutationUnderLock({
      storage, locks, prepare, execute: vi.fn(), onState: vi.fn(), authority,
    });
    expect(prepare).not.toHaveBeenCalled();

    const reconcile = vi.fn();
    await reconcileModelRecoveryUnderLock({
      storage, locks, recoveryRef: "plausible_ref", reconcile, onState: vi.fn(), authority,
    });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("reuses sticky authority across component rebuilds in one document and isolates another document", async () => {
    const documentScope = {};
    const firstMount = getModelRecoveryStateAuthorityForDocument(documentScope);
    firstMount.observe({ kind: "corrupt" });

    const rebuiltMount = getModelRecoveryStateAuthorityForDocument(documentScope);
    expect(rebuiltMount).toBe(firstMount);
    expect(rebuiltMount.observe({ kind: "clear" })).toEqual({ kind: "corrupt" });

    const storage = new MemoryStorage();
    const prepare = vi.fn();
    await runModelMutationUnderLock({
      storage, locks: new SerialLocks(), prepare, execute: vi.fn(), onState: vi.fn(), authority: rebuiltMount,
    });
    expect(prepare).not.toHaveBeenCalled();

    const isolatedDocument = getModelRecoveryStateAuthorityForDocument({});
    expect(isolatedDocument).not.toBe(firstMount);
    expect(isolatedDocument.observe({ kind: "clear" })).toEqual({ kind: "clear" });
  });

  it("does not clear a replacement ref after a successful effect", async () => {
    const storage = new MemoryStorage();
    const result = await runModelMutationUnderLock({
      storage,
      locks: new SerialLocks(),
      prepare: async () => ({ recoveryRef: "this_tab" }),
      execute: async () => { storage.setItem(MODEL_RECOVERY_STORAGE_KEY, "other_tab"); return "committed"; },
      onState: vi.fn(),
      authority: createModelRecoveryStateAuthority(),
    });

    expect(result).toEqual({ kind: "ownership_lost", state: { kind: "pending", recoveryRef: "other_tab" } });
    expect(storage.getItem(MODEL_RECOVERY_STORAGE_KEY)).toBe("other_tab");
  });

  it("does not clear its restored ref when corruption became sticky during execute", async () => {
    const storage = new MemoryStorage();
    const locks = new SerialLocks();
    const authority = createModelRecoveryStateAuthority();
    const executed = deferred<string>();
    const execute = vi.fn(() => executed.promise);
    const mutation = runModelMutationUnderLock({
      storage,
      locks,
      prepare: async () => ({ recoveryRef: "own_ref" }),
      execute,
      onState: vi.fn(),
      authority,
    });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, "corrupt:value");
    expect(modelRecoveryStateFromStorageEvent({
      key: MODEL_RECOVERY_STORAGE_KEY, storageArea: storage,
    }, storage, locks, authority)).toEqual({ kind: "corrupt" });
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, "own_ref");

    executed.resolve("committed");

    await expect(mutation).resolves.toEqual({ kind: "ownership_lost", state: { kind: "corrupt" } });
    expect(storage.getItem(MODEL_RECOVERY_STORAGE_KEY)).toBe("own_ref");
    expect(storage.removeCalls).toBe(0);
  });

  it("does not clear its restored ref when corruption became sticky during reconciliation", async () => {
    const storage = new MemoryStorage();
    const locks = new SerialLocks();
    const authority = createModelRecoveryStateAuthority();
    const reconciled = deferred<string>();
    const reconcile = vi.fn(() => reconciled.promise);
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, "own_ref");
    const operation = reconcileModelRecoveryUnderLock({
      storage, locks, recoveryRef: "own_ref", reconcile, onState: vi.fn(), authority,
    });
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, "corrupt:value");
    expect(modelRecoveryStateFromStorageEvent({
      key: MODEL_RECOVERY_STORAGE_KEY, storageArea: storage,
    }, storage, locks, authority)).toEqual({ kind: "corrupt" });
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, "own_ref");

    reconciled.resolve("committed");

    await expect(operation).resolves.toEqual({ kind: "ownership_lost", state: { kind: "corrupt" } });
    expect(storage.getItem(MODEL_RECOVERY_STORAGE_KEY)).toBe("own_ref");
    expect(storage.removeCalls).toBe(0);
  });

  it("still clears one exact healthy pending ref after a successful effect", async () => {
    const storage = new MemoryStorage();
    const result = await runModelMutationUnderLock({
      storage,
      locks: new SerialLocks(),
      prepare: async () => ({ recoveryRef: "own_ref" }),
      execute: async () => "committed",
      onState: vi.fn(),
      authority: createModelRecoveryStateAuthority(),
    });

    expect(result).toEqual({ kind: "completed", value: "committed" });
    expect(storage.getItem(MODEL_RECOVERY_STORAGE_KEY)).toBeNull();
    expect(storage.removeCalls).toBe(1);
  });

  it("reconciliation rereads the exact ref and compare-removes only its own value", async () => {
    const storage = new MemoryStorage();
    storage.setItem(MODEL_RECOVERY_STORAGE_KEY, "newer_tab");
    const reconcile = vi.fn(async () => "committed");

    const result = await reconcileModelRecoveryUnderLock({
      storage, locks: new SerialLocks(), recoveryRef: "older_tab", reconcile, onState: vi.fn(),
      authority: createModelRecoveryStateAuthority(),
    });

    expect(result).toEqual({ kind: "blocked", state: { kind: "pending", recoveryRef: "newer_tab" } });
    expect(reconcile).not.toHaveBeenCalled();
    expect(storage.getItem(MODEL_RECOVERY_STORAGE_KEY)).toBe("newer_tab");
  });
});
