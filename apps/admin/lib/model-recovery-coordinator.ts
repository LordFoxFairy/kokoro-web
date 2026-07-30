export const MODEL_RECOVERY_STORAGE_KEY = "kokoro.admin.model-recovery.v1";
export const MODEL_RECOVERY_LOCK_NAME = "kokoro.admin.model-recovery.mutation.v1";

const MODEL_RECOVERY_REF = /^[A-Za-z0-9_-]{1,1024}$/u;

export type ModelRecoveryState =
  | Readonly<{ kind: "initializing" }>
  | Readonly<{ kind: "clear" }>
  | Readonly<{ kind: "pending"; recoveryRef: string }>
  | Readonly<{ kind: "corrupt" }>
  | Readonly<{ kind: "unavailable"; reason: "locks" | "storage" | "invalid_prepared_ref" }>;

export const INITIAL_MODEL_RECOVERY_STATE: ModelRecoveryState = Object.freeze({ kind: "initializing" });

export interface ModelRecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ModelRecoveryLockManager {
  request<T>(name: string, options: Readonly<{ mode: "exclusive" }>, callback: () => Promise<T>): Promise<T>;
}

export interface ModelRecoveryStorageEvent {
  readonly key: string | null;
  readonly storageArea: unknown;
}

export interface ModelRecoveryStateAuthority {
  readonly corruptObserved: boolean;
  observe(state: ModelRecoveryState): ModelRecoveryState;
}

export function createModelRecoveryStateAuthority(): ModelRecoveryStateAuthority {
  let corruptObserved = false;
  return {
    get corruptObserved() { return corruptObserved; },
    observe(state) {
      if (corruptObserved) return { kind: "corrupt" };
      if (state.kind === "corrupt") corruptObserved = true;
      return state;
    },
  };
}

export type ModelRecoveryOperationResult<T> =
  | Readonly<{ kind: "completed"; value: T }>
  | Readonly<{ kind: "blocked"; state: ModelRecoveryState }>
  | Readonly<{ kind: "ownership_lost"; state: ModelRecoveryState }>;

export function readModelRecoveryState(storage: ModelRecoveryStorage): ModelRecoveryState {
  const stored = storage.getItem(MODEL_RECOVERY_STORAGE_KEY);
  if (stored === null) return { kind: "clear" };
  if (MODEL_RECOVERY_REF.test(stored)) return { kind: "pending", recoveryRef: stored };
  return { kind: "corrupt" };
}

export function readAvailableModelRecoveryState(
  storage: ModelRecoveryStorage,
  locks: ModelRecoveryLockManager | null,
): ModelRecoveryState {
  try {
    const stored = readModelRecoveryState(storage);
    if (stored.kind !== "clear" || locks !== null) return stored;
    return { kind: "unavailable", reason: "locks" };
  } catch {
    return { kind: "unavailable", reason: "storage" };
  }
}

export function modelRecoveryStateFromStorageEvent(
  event: ModelRecoveryStorageEvent,
  storage: ModelRecoveryStorage,
  locks: ModelRecoveryLockManager | null,
  authority: ModelRecoveryStateAuthority,
): ModelRecoveryState | null {
  if (event.storageArea !== storage
    || (event.key !== MODEL_RECOVERY_STORAGE_KEY && event.key !== null)) return null;
  return authority.observe(readAvailableModelRecoveryState(storage, locks));
}

export function compareAndRemoveModelRecovery(
  storage: ModelRecoveryStorage,
  expectedRecoveryRef: string,
): ModelRecoveryState {
  if (storage.getItem(MODEL_RECOVERY_STORAGE_KEY) !== expectedRecoveryRef) {
    return readModelRecoveryState(storage);
  }
  storage.removeItem(MODEL_RECOVERY_STORAGE_KEY);
  return readModelRecoveryState(storage);
}

export async function runModelMutationUnderLock<T>(options: Readonly<{
  storage: ModelRecoveryStorage;
  locks: ModelRecoveryLockManager | null;
  prepare: () => Promise<Readonly<{ recoveryRef: string }>>;
  execute: (recoveryRef: string) => Promise<T>;
  onState: (state: ModelRecoveryState) => void;
  authority: ModelRecoveryStateAuthority;
}>): Promise<ModelRecoveryOperationResult<T>> {
  const publish = (state: ModelRecoveryState) => {
    const authorized = options.authority.observe(state);
    options.onState(authorized);
    return authorized;
  };
  if (options.locks === null) {
    const state = publish({ kind: "unavailable", reason: "locks" });
    return { kind: "blocked", state };
  }

  let entered = false;
  try {
    return await options.locks.request(MODEL_RECOVERY_LOCK_NAME, { mode: "exclusive" }, async () => {
      entered = true;
      const current = publish(readAvailableModelRecoveryState(options.storage, options.locks));
      if (current.kind !== "clear") return { kind: "blocked", state: current };

      const prepared = await options.prepare();
      if (!MODEL_RECOVERY_REF.test(prepared.recoveryRef)) {
        const state = publish({ kind: "unavailable", reason: "invalid_prepared_ref" });
        return { kind: "blocked", state };
      }

      try {
        options.storage.setItem(MODEL_RECOVERY_STORAGE_KEY, prepared.recoveryRef);
      } catch {
        const state = publish({ kind: "unavailable", reason: "storage" });
        return { kind: "blocked", state };
      }
      const persisted = publish(readAvailableModelRecoveryState(options.storage, options.locks));
      if (persisted.kind !== "pending" || persisted.recoveryRef !== prepared.recoveryRef) {
        return { kind: "ownership_lost", state: persisted };
      }

      let value: T;
      try {
        value = await options.execute(prepared.recoveryRef);
      } catch (error) {
        publish(readAvailableModelRecoveryState(options.storage, options.locks));
        throw error;
      }

      let cleared: ModelRecoveryState;
      try {
        cleared = compareAndRemoveModelRecovery(options.storage, prepared.recoveryRef);
      } catch {
        cleared = { kind: "unavailable", reason: "storage" };
      }
      cleared = publish(cleared);
      if (cleared.kind !== "clear") return { kind: "ownership_lost", state: cleared };
      return { kind: "completed", value };
    });
  } catch (error) {
    if (entered) throw error;
    const state = publish({ kind: "unavailable", reason: "locks" });
    return { kind: "blocked", state };
  }
}

export async function reconcileModelRecoveryUnderLock<T>(options: Readonly<{
  storage: ModelRecoveryStorage;
  locks: ModelRecoveryLockManager | null;
  recoveryRef: string;
  reconcile: () => Promise<T>;
  onState: (state: ModelRecoveryState) => void;
  authority: ModelRecoveryStateAuthority;
}>): Promise<ModelRecoveryOperationResult<T>> {
  const publish = (state: ModelRecoveryState) => {
    const authorized = options.authority.observe(state);
    options.onState(authorized);
    return authorized;
  };
  if (options.locks === null) {
    const state = publish({ kind: "unavailable", reason: "locks" });
    return { kind: "blocked", state };
  }

  let entered = false;
  try {
    return await options.locks.request(MODEL_RECOVERY_LOCK_NAME, { mode: "exclusive" }, async () => {
      entered = true;
      const current = publish(readAvailableModelRecoveryState(options.storage, options.locks));
      if (current.kind !== "pending" || current.recoveryRef !== options.recoveryRef) {
        return { kind: "blocked", state: current };
      }

      const value = await options.reconcile();
      let cleared: ModelRecoveryState;
      try {
        cleared = compareAndRemoveModelRecovery(options.storage, options.recoveryRef);
      } catch {
        cleared = { kind: "unavailable", reason: "storage" };
      }
      cleared = publish(cleared);
      if (cleared.kind !== "clear") return { kind: "ownership_lost", state: cleared };
      return { kind: "completed", value };
    });
  } catch (error) {
    if (entered) throw error;
    const state = publish({ kind: "unavailable", reason: "locks" });
    return { kind: "blocked", state };
  }
}
