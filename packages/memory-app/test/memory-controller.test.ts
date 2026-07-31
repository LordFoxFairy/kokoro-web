import type { MemoryCommandResponse, MemoryEntryActiveView, MemoryRevisionView } from "@kokoro/site-client"
import { describe, expect, test } from "vitest"

import {
  beginMemorySelection,
  createMemoryBrowserClient,
  createMemoryCommandJournal,
  memoryCommandRequiresRecovery,
  mergeMemoryEntries,
  mergeMemoryHistory,
  projectMemoryCommand,
  projectMemoryReadEpoch,
  reconcileMemoryEntryPage,
  settleMemorySelection,
  type MemoryControllerState,
  type MemoryStorage,
} from "../src/memory-controller"

function entry(overrides: Partial<MemoryEntryActiveView> = {}): MemoryEntryActiveView {
  return {
    category: "preference",
    content: "Prefer concise answers",
    createdAt: "2026-07-31T00:00:00.000Z",
    currentRevisionRef: "revision-1",
    entryRef: "entry-1",
    entryVersion: "1",
    prioritized: false,
    revision: 1,
    scopeKind: "user",
    source: { safeLabel: "Saved by you", sourceKind: "explicit", state: "current" },
    state: "active",
    updatedAt: "2026-07-31T00:00:00.000Z",
    validFrom: null,
    validTo: null,
    ...overrides,
  }
}

function controllerState(): MemoryControllerState {
  return {
    generation: 4,
    settings: null,
    entries: [entry()],
    nextCursor: "next-page",
    selectedEntryRef: "entry-1",
    selectedEntry: entry(),
    history: [],
    historyNextCursor: null,
    exports: [],
    imports: [],
    pendingCommands: [],
    spacePurge: null,
  }
}

describe("Memory controller", () => {
  test("classifies every command lifecycle state before resolving the recovery journal", () => {
    const cursor = {
      commandId: "f".repeat(32),
      commandKind: "resetMemorySpace" as const,
      receiptRef: "receipt-lifecycle-1",
      receivedAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:01.000Z",
    }
    const pending = (["accepted", "executing", "outcome_unknown"] as const).map((state) => ({
      command: cursor,
      retryAfter: "2026-07-31T00:01:00.000Z",
      state,
    } satisfies MemoryCommandResponse))
    const succeeded = {
      command: cursor,
      result: { resultKind: "entry", entry: entry() },
      state: "succeeded",
    } satisfies MemoryCommandResponse
    const purge = (purgeState: "revoked_purge_pending" | "purged") => ({
      command: cursor,
      result: { resultKind: "purge", effectiveAt: "2026-07-31T00:00:01.000Z", entryRef: null, purgeReceiptRef: "purge-space-1", purgeScope: "space", purgeState },
      state: "succeeded",
    }) satisfies MemoryCommandResponse
    const rejected = {
      command: cursor,
      rejection: { code: "policy_rejected", retryAfter: null, retryClass: "never" },
      state: "rejected",
    } satisfies MemoryCommandResponse

    expect([...pending, succeeded, purge("revoked_purge_pending"), purge("purged"), rejected].map(memoryCommandRequiresRecovery))
      .toEqual([true, true, true, false, true, false, false])
  })

  test("merges cursor pages monotonically and rejects same-version owner conflicts", () => {
    expect(mergeMemoryEntries([entry()], [entry({ entryVersion: "2", revision: 2, currentRevisionRef: "revision-2", content: "Prefer direct answers" }), entry({ entryRef: "entry-2" })]))
      .toEqual([
        entry({ entryVersion: "2", revision: 2, currentRevisionRef: "revision-2", content: "Prefer direct answers" }),
        entry({ entryRef: "entry-2" }),
      ])
    expect(() => mergeMemoryEntries([entry()], [entry({ content: "Conflicting owner fact" })]))
      .toThrow("Memory entry owner version conflict")
  })

  test("clears A synchronously and ignores A after a deep-link switch to B", () => {
    const loadingB = beginMemorySelection(controllerState(), "entry-2")
    expect(loadingB).toMatchObject({ generation: 5, selectedEntryRef: "entry-2", selectedEntry: null, history: [] })
    expect(settleMemorySelection(loadingB, 4, entry(), [])).toBe(loadingB)
    expect(settleMemorySelection(loadingB, 5, entry({ entryRef: "entry-2" }), [])).toMatchObject({
      selectedEntry: { entryRef: "entry-2" },
    })
  })

  test("keeps immutable revision history monotonic and detects revision conflicts", () => {
    const first: MemoryRevisionView = {
      content: "A",
      reason: "explicit",
      recordedAt: "2026-07-31T00:00:00.000Z",
      restorable: true,
      revision: 1,
      revisionRef: "revision-1",
      state: "available",
      supersedesRevisionRef: null,
      validFrom: null,
      validTo: null,
    }
    const second: MemoryRevisionView = { ...first, content: "B", reason: "corrected", revision: 2, revisionRef: "revision-2", supersedesRevisionRef: "revision-1" }
    expect(mergeMemoryHistory([second], [first])).toEqual([second, first])
    expect(() => mergeMemoryHistory([first], [{ ...first, content: "changed" }])).toThrow("Memory revision conflict")
  })

  test("projects priority, purge-pending, import and export owner outcomes", () => {
    const priority = {
      state: "succeeded",
      command: { commandId: "a".repeat(32), commandKind: "prioritizeMemoryEntry", receiptRef: "receipt-1", receivedAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-07-31T00:00:01.000Z" },
      result: { resultKind: "entry", entry: entry({ prioritized: true, entryVersion: "2" }) },
    } satisfies MemoryCommandResponse
    const prioritized = projectMemoryCommand(controllerState(), priority)
    expect(prioritized.entries[0]?.prioritized).toBe(true)

    const purge = {
      state: "succeeded",
      command: { commandId: "b".repeat(32), commandKind: "forgetMemoryEntry", receiptRef: "receipt-2", receivedAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-07-31T00:00:01.000Z" },
      result: { resultKind: "purge", effectiveAt: "2026-07-31T00:00:01.000Z", entryRef: "entry-1", purgeReceiptRef: "purge-1", purgeScope: "entry", purgeState: "revoked_purge_pending" },
    } satisfies MemoryCommandResponse
    const forgotten = projectMemoryCommand(prioritized, purge)
    expect(forgotten.entries).toEqual([])
    expect(forgotten.selectedEntry).toMatchObject({ state: "revoked_purge_pending", purgeReceiptRef: "purge-1" })
    expect(forgotten).toMatchObject({
      generation: 5,
      history: [],
      historyNextCursor: null,
      nextCursor: null,
    })

    const exportResult = {
      state: "succeeded",
      command: { commandId: "c".repeat(32), commandKind: "requestMemoryExport", receiptRef: "receipt-3", receivedAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-07-31T00:00:01.000Z" },
      result: { resultKind: "export", export: { artifactDownloadRequest: null, expiresAt: null, exportRef: "export-1", failureCode: null, format: "kokoro_memory_export_v1", requestedAt: "2026-07-31T00:00:00.000Z", state: "queued", updatedAt: "2026-07-31T00:00:01.000Z" } },
    } satisfies MemoryCommandResponse
    expect(projectMemoryCommand(forgotten, exportResult).exports[0]?.state).toBe("queued")
  })

  test("rejects stale initial deep-link projections after reset or forget advances the read epoch", () => {
    const command = (commandKind: "resetMemorySpace" | "forgetMemoryEntry", entryRef: string | null) => ({
      command: {
        commandId: commandKind === "resetMemorySpace" ? "1".repeat(32) : "2".repeat(32),
        commandKind,
        receiptRef: `receipt-${commandKind}`,
        receivedAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:01.000Z",
      },
      result: {
        effectiveAt: "2026-07-31T00:00:01.000Z",
        entryRef,
        purgeReceiptRef: `purge-${commandKind}`,
        purgeScope: entryRef === null ? "space" as const : "entry" as const,
        purgeState: "revoked_purge_pending" as const,
        resultKind: "purge" as const,
      },
      state: "succeeded" as const,
    })
    const initialEpoch = controllerState()
    const staleProjection = () => Object.freeze({
      ...initialEpoch,
      entries: [entry({ content: "Stale initial list" })],
      selectedEntry: entry({ content: "Stale initial detail" }),
    })
    const reset = projectMemoryCommand(initialEpoch, command("resetMemorySpace", null))
    const forgotten = projectMemoryCommand(initialEpoch, command("forgetMemoryEntry", "entry-1"))

    expect(projectMemoryReadEpoch(reset, initialEpoch.generation, staleProjection)).toBe(reset)
    expect(projectMemoryReadEpoch(forgotten, initialEpoch.generation, staleProjection)).toBe(forgotten)
  })

  test("keeps a reset recovery receipt until the owner confirms physical space purge", () => {
    const commandId = "e".repeat(32)
    const pending = {
      ...controllerState(),
      pendingCommands: [{ commandId, commandKind: "resetMemorySpace" as const, createdAt: "2026-07-31T00:00:00.000Z", targetRef: null }],
    }
    const response = (purgeState: "revoked_purge_pending" | "purged") => ({
      state: "succeeded",
      command: { commandId, commandKind: "resetMemorySpace", receiptRef: "receipt-reset-1", receivedAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-07-31T00:00:01.000Z" },
      result: { resultKind: "purge", effectiveAt: "2026-07-31T00:00:01.000Z", entryRef: null, purgeReceiptRef: "purge-space-1", purgeScope: "space", purgeState },
    }) satisfies MemoryCommandResponse

    const revoked = projectMemoryCommand(pending, response("revoked_purge_pending"))
    expect(revoked.pendingCommands).toHaveLength(1)
    expect((revoked as unknown as { spacePurge: unknown }).spacePurge).toEqual({
      effectiveAt: "2026-07-31T00:00:01.000Z",
      purgeReceiptRef: "purge-space-1",
      purgeState: "revoked_purge_pending",
    })
    expect(revoked).toMatchObject({
      generation: 5,
      history: [],
      historyNextCursor: null,
      nextCursor: null,
      selectedEntry: null,
      selectedEntryRef: null,
    })

    const purged = projectMemoryCommand(revoked, response("purged"))
    expect(purged.pendingCommands).toEqual([])
    expect((purged as unknown as { spacePurge: unknown }).spacePurge).toMatchObject({ purgeState: "purged" })
  })

  test("journals ambiguous commands by Site scope and recovers without changing identity", () => {
    const values = new Map<string, string>()
    const storage: MemoryStorage = {
      get length() { return values.size },
      key(index) { return [...values.keys()][index] ?? null },
      getItem(key) { return values.get(key) ?? null },
      setItem(key, value) { values.set(key, value) },
      removeItem(key) { values.delete(key) },
    }
    const journal = createMemoryCommandJournal({ storage, scope: "scope-a", now: () => Date.parse("2026-07-31T01:00:00.000Z") })
    const record = { commandId: "d".repeat(32), commandKind: "correctMemoryEntry" as const, createdAt: "2026-07-31T00:00:00.000Z", targetRef: "entry-1" }
    journal.remember(record)
    expect(journal.list()).toEqual([record])
    journal.resolve(record.commandId)
    expect(journal.list()).toEqual([])
  })

  test("accepts only the exact BFF-projected Artifact export delivery path", async () => {
    const response = (deliveryUrl: string) => Response.json({
      export: {
        artifactDownloadRequest: {
          artifactRef: "artifact:memory-1",
          artifactVersionRef: "version:memory-1",
          deliveryRequestRef: "delivery:memory-1",
          deliveryUrl,
          purpose: "export",
        },
        expiresAt: "2026-08-01T00:00:00.000Z",
        exportRef: "export-1",
        failureCode: null,
        format: "kokoro_memory_export_v1",
        requestedAt: "2026-07-31T00:00:00.000Z",
        state: "ready",
        updatedAt: "2026-07-31T00:00:01.000Z",
      },
    })
    const expected = "/api/media/artifacts/artifact%3Amemory-1/versions/version%3Amemory-1/content?purpose=export&exportIntentRef=delivery%3Amemory-1"
    const accepted = createMemoryBrowserClient({ csrfToken: "csrf", fetch: () => Promise.resolve(response(expected)) })

    await expect(accepted.getExport("export-1")).resolves.toMatchObject({
      export: { artifactDownloadRequest: { deliveryUrl: expected } },
    })

    const malicious = createMemoryBrowserClient({ csrfToken: "csrf", fetch: () => Promise.resolve(response("https://attacker.invalid/export")) })
    await expect(malicious.getExport("export-1")).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })
  })

  test("rejects a recovery response for a different command identity", async () => {
    const requestedCommandId = "a".repeat(32)
    const client = createMemoryBrowserClient({
      csrfToken: "csrf",
      fetch: () => Promise.resolve(Response.json({
        command: {
          commandId: "b".repeat(32),
          commandKind: "rememberMemoryEntry",
          receiptRef: "receipt-1",
          receivedAt: "2026-07-31T00:00:00.000Z",
          updatedAt: "2026-07-31T00:00:01.000Z",
        },
        retryAfter: "2026-07-31T00:00:02.000Z",
        state: "accepted",
      })),
    })

    await expect(client.recover({
      commandId: requestedCommandId,
      commandKind: "rememberMemoryEntry",
      createdAt: "2026-07-31T00:00:00.000Z",
      targetRef: null,
    })).rejects.toMatchObject({
      code: "BFF_PROTOCOL_INVALID",
    })
  })

  test("rejects schema-valid direct command kind and result semantic mismatches", async () => {
    const command = { commandId: "a".repeat(32), idempotencyKey: "b".repeat(48) }
    const response = (commandKind: "prioritizeMemoryEntry" | "resetMemorySpace", result: unknown) => Response.json({
      command: {
        commandId: command.commandId,
        commandKind,
        receiptRef: "receipt-semantic-1",
        receivedAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:01.000Z",
      },
      result,
      state: "succeeded",
    })
    const wrongKind = createMemoryBrowserClient({
      csrfToken: "csrf",
      fetch: () => Promise.resolve(response("resetMemorySpace", {
        entry: entry({ entryVersion: "2", prioritized: true }),
        resultKind: "entry",
      })),
    })
    await expect(wrongKind.prioritize("entry-1", { expectedEntryVersion: "1" }, command))
      .rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    const wrongResult = createMemoryBrowserClient({
      csrfToken: "csrf",
      fetch: () => Promise.resolve(response("prioritizeMemoryEntry", {
        effectiveAt: "2026-07-31T00:00:01.000Z",
        entryRef: null,
        purgeReceiptRef: "purge-space-1",
        purgeScope: "space",
        purgeState: "purged",
        resultKind: "purge",
      })),
    })
    await expect(wrongResult.prioritize("entry-1", { expectedEntryVersion: "1" }, command))
      .rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    const wrongTarget = createMemoryBrowserClient({
      csrfToken: "csrf",
      fetch: () => Promise.resolve(response("prioritizeMemoryEntry", {
        entry: entry({ entryRef: "entry-other", entryVersion: "2", prioritized: true }),
        resultKind: "entry",
      })),
    })
    await expect(wrongTarget.prioritize("entry-1", { expectedEntryVersion: "1" }, command))
      .rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })
  })

  test("rejects direct command results with the wrong operation-specific semantics", async () => {
    const command = { commandId: "a".repeat(32), idempotencyKey: "b".repeat(48) }
    const cursor = (commandKind: "prioritizeMemoryEntry" | "restoreMemoryEntryRevision" | "requestMemoryImport") => ({
      commandId: command.commandId,
      commandKind,
      receiptRef: "receipt-semantic-2",
      receivedAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:01.000Z",
    })
    const wrongPriority = createMemoryBrowserClient({
      csrfToken: "csrf",
      fetch: () => Promise.resolve(Response.json({
        command: cursor("prioritizeMemoryEntry"),
        result: { entry: entry({ entryVersion: "2", prioritized: false }), resultKind: "entry" },
        state: "succeeded",
      })),
    })
    await expect(wrongPriority.prioritize("entry-1", { expectedEntryVersion: "1" }, command))
      .rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    const wrongRestoreRevision = createMemoryBrowserClient({
      csrfToken: "csrf",
      fetch: () => Promise.resolve(Response.json({
        command: cursor("restoreMemoryEntryRevision"),
        result: {
          entry: entry({ currentRevisionRef: "revision-3", entryVersion: "2", revision: 3 }),
          newRevision: 3,
          newRevisionRef: "revision-3",
          restoredFromRevisionRef: "revision-other",
          resultKind: "restored",
        },
        state: "succeeded",
      })),
    })
    await expect(wrongRestoreRevision.restore("entry-1", "revision-requested", { expectedRevision: 2 }, command))
      .rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    const wrongImportVersion = createMemoryBrowserClient({
      csrfToken: "csrf",
      fetch: () => Promise.resolve(Response.json({
        command: cursor("requestMemoryImport"),
        result: {
          import: {
            acceptedEntryCount: 0,
            assetRef: "asset:memory-1",
            assetVersionRef: "version:other",
            format: "kokoro_memory_export_v1",
            importRef: "import-1",
            rejectedEntryCount: 0,
            requestedAt: "2026-07-31T00:00:00.000Z",
            safeStatusCode: null,
            state: "queued",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          resultKind: "import",
        },
        state: "succeeded",
      })),
    })
    await expect(wrongImportVersion.requestImport({
      assetRef: "asset:memory-1",
      assetVersionRef: "version:requested",
      conflictPolicy: "quarantine",
      format: "kokoro_memory_export_v1",
    }, command)).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })
  })

  test("adopts a priority page only when it contains the confirmed owner version", () => {
    const confirmed = entry({ entryVersion: "3", prioritized: true })
    const other = entry({ entryRef: "entry-2" })

    expect(reconcileMemoryEntryPage([other, confirmed], [other, entry({ entryVersion: "2" })], confirmed)).toBeNull()
    expect(reconcileMemoryEntryPage([other, confirmed], [other], confirmed)).toBeNull()
    expect(reconcileMemoryEntryPage([other, confirmed], [confirmed, other], confirmed)?.map(({ entryRef }) => entryRef))
      .toEqual(["entry-1", "entry-2"])
  })

  test("rejects an old priority page after a newer priority or correction projection", () => {
    const confirmedPriority = entry({ entryVersion: "3", prioritized: true })
    const oldPriorityPage = [confirmedPriority, entry({ entryRef: "entry-2" })]
    const laterDepriority = entry({ entryVersion: "4", prioritized: false })
    const laterCorrection = entry({ content: "Corrected after priority", entryVersion: "4", prioritized: true, revision: 2 })

    expect(reconcileMemoryEntryPage([laterDepriority], oldPriorityPage, confirmedPriority)).toBeNull()
    expect(reconcileMemoryEntryPage([laterCorrection], oldPriorityPage, confirmedPriority)).toBeNull()
  })

  test("persists non-sensitive restore and import recovery semantics and rejects incomplete records", () => {
    const values = new Map<string, string>()
    const storage: MemoryStorage = {
      get length() { return values.size },
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key) },
      setItem: (key, value) => { values.set(key, value) },
    }
    const journal = createMemoryCommandJournal({ storage, scope: "site-a:user-1", now: () => Date.parse("2026-07-31T00:01:00.000Z") })
    journal.remember({
      commandId: "c".repeat(32),
      commandKind: "restoreMemoryEntryRevision",
      createdAt: "2026-07-31T00:00:00.000Z",
      restoredFromRevisionRef: "revision-requested",
      targetRef: "entry-1",
    })
    journal.remember({
      assetVersionRef: "version:requested",
      commandId: "d".repeat(32),
      commandKind: "requestMemoryImport",
      createdAt: "2026-07-31T00:00:00.000Z",
      targetRef: "asset:memory-1",
    })

    expect(journal.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ restoredFromRevisionRef: "revision-requested" }),
      expect.objectContaining({ assetVersionRef: "version:requested" }),
    ]))

    const invalidId = "e".repeat(32)
    storage.setItem(`kokoro.memory.command.v1:${encodeURIComponent("site-a:user-1")}:${invalidId}`, JSON.stringify({
      commandId: invalidId,
      commandKind: "restoreMemoryEntryRevision",
      createdAt: "2026-07-31T00:00:00.000Z",
      targetRef: "entry-1",
    }))
    expect(journal.list().some(({ commandId }) => commandId === invalidId)).toBe(false)
  })

  test("rejects recovered results that mismatch persisted restore or import targets", async () => {
    const restoreId = "f".repeat(32)
    const restoreClient = createMemoryBrowserClient({
      csrfToken: "csrf",
      fetch: () => Promise.resolve(Response.json({
        command: {
          commandId: restoreId,
          commandKind: "restoreMemoryEntryRevision",
          receiptRef: "receipt-recovered-restore",
          receivedAt: "2026-07-31T00:00:00.000Z",
          updatedAt: "2026-07-31T00:00:01.000Z",
        },
        result: {
          entry: entry({ currentRevisionRef: "revision-3", entryVersion: "2", revision: 3 }),
          newRevision: 3,
          newRevisionRef: "revision-3",
          restoredFromRevisionRef: "revision-other",
          resultKind: "restored",
        },
        state: "succeeded",
      })),
    })
    await expect(restoreClient.recover({
      commandId: restoreId,
      commandKind: "restoreMemoryEntryRevision",
      createdAt: "2026-07-31T00:00:00.000Z",
      restoredFromRevisionRef: "revision-requested",
      targetRef: "entry-1",
    })).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    const importId = "9".repeat(32)
    const importClient = createMemoryBrowserClient({
      csrfToken: "csrf",
      fetch: () => Promise.resolve(Response.json({
        command: {
          commandId: importId,
          commandKind: "requestMemoryImport",
          receiptRef: "receipt-recovered-import",
          receivedAt: "2026-07-31T00:00:00.000Z",
          updatedAt: "2026-07-31T00:00:01.000Z",
        },
        result: {
          import: {
            acceptedEntryCount: 0,
            assetRef: "asset:memory-1",
            assetVersionRef: "version:other",
            format: "kokoro_memory_export_v1",
            importRef: "import-1",
            rejectedEntryCount: 0,
            requestedAt: "2026-07-31T00:00:00.000Z",
            safeStatusCode: null,
            state: "queued",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          resultKind: "import",
        },
        state: "succeeded",
      })),
    })
    await expect(importClient.recover({
      assetVersionRef: "version:requested",
      commandId: importId,
      commandKind: "requestMemoryImport",
      createdAt: "2026-07-31T00:00:00.000Z",
      targetRef: "asset:memory-1",
    })).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })
  })
})
