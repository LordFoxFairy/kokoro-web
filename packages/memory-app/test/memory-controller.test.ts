import type { MemoryCommandResponse, MemoryEntryActiveView, MemoryEntryHistoryPage, MemoryOwnerSnapshot, MemoryRevisionView } from "@kokoro/site-client"
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
  reconcileMemoryHistoryPage,
  reconcileMemoryOwnerPage,
  settleMemoryExportRefresh,
  settleMemoryImportRefresh,
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

function ownerSnapshot(spaceVersion: string, snapshotRef = `snapshot:${spaceVersion}`): MemoryOwnerSnapshot {
  return { snapshotRef, spaceVersion }
}

function historyPage(entryRef: string, spaceVersion: string, items: readonly MemoryRevisionView[] = []): MemoryEntryHistoryPage {
  return {
    entryRef,
    items: [...items],
    ownerSnapshot: ownerSnapshot(spaceVersion, `history-snapshot:${spaceVersion}`),
    pageInfo: { hasMore: false, nextCursor: null },
  }
}

function controllerState(): MemoryControllerState {
  return {
    currentOwnerSnapshot: { snapshotRef: "snapshot:current", spaceVersion: "1" },
    generation: 4,
    settings: null,
    entries: [entry()],
    entryOwnerKnowledge: [],
    nextCursor: "next-page",
    selectedEntryRef: "entry-1",
    selectedEntry: entry(),
    history: [],
    currentHistoryOwnerSnapshot: null,
    historyNextCursor: null,
    exports: [],
    imports: [],
    minimumSpaceVersion: "1",
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
      committedSpaceVersion: "2",
      result: { resultKind: "entry", entry: entry() },
      state: "succeeded",
    } satisfies MemoryCommandResponse
    const purge = (purgeState: "revoked_purge_pending" | "purged") => ({
      command: cursor,
      committedSpaceVersion: "2",
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

  test("keeps selected detail monotonic when an older succeeded command arrives last", () => {
    const currentEntry = entry({
      content: "Newest owner view",
      currentRevisionRef: "revision-4",
      entryVersion: "4",
      revision: 4,
      updatedAt: "2026-07-31T00:00:04.000Z",
    })
    const staleEntry = entry({
      content: "Older owner view",
      currentRevisionRef: "revision-3",
      entryVersion: "3",
      revision: 3,
      updatedAt: "2026-07-31T00:00:03.000Z",
    })
    const current = {
      ...controllerState(),
      currentOwnerSnapshot: ownerSnapshot("4"),
      entries: [currentEntry],
      minimumSpaceVersion: "4",
      selectedEntry: currentEntry,
    }
    const projected = projectMemoryCommand(current, {
      command: {
        commandId: "7".repeat(32),
        commandKind: "correctMemoryEntry",
        receiptRef: "receipt-stale-correction",
        receivedAt: "2026-07-31T00:00:02.000Z",
        updatedAt: "2026-07-31T00:00:03.000Z",
      },
      committedSpaceVersion: "3",
      result: { entry: staleEntry, resultKind: "entry" },
      state: "succeeded",
    })

    expect(projected.generation).toBe(current.generation)
    expect(projected.entries[0]).toEqual(currentEntry)
    expect(projected.selectedEntry).toEqual(currentEntry)
  })

  test("does not project any owner payload from a command below the space-version floor", () => {
    const newest = entry({
      content: "Newest owner view",
      currentRevisionRef: "revision-9",
      entryVersion: "9",
      revision: 9,
    })
    const current = {
      ...controllerState(),
      entries: [newest],
      minimumSpaceVersion: "9",
      selectedEntry: newest,
      settings: {
        automaticLearning: { availability: "unavailable_until_memory_m3" as const, effective: false as const, policyReason: null, requested: false as const },
        observedAt: "2026-07-31T00:00:09.000Z",
        pastChatReference: { availability: "unavailable_until_session_m1a" as const, effective: false as const, policyReason: null, requested: false as const },
        revision: "9",
        savedMemoryUse: { availability: "available" as const, effective: true, policyReason: null, requested: true },
      },
    }
    const stalePurge = projectMemoryCommand(current, {
      command: {
        commandId: "6".repeat(32),
        commandKind: "resetMemorySpace",
        receiptRef: "receipt-old-reset",
        receivedAt: "2026-07-31T00:00:01.000Z",
        updatedAt: "2026-07-31T00:00:02.000Z",
      },
      committedSpaceVersion: "8",
      result: {
        effectiveAt: "2026-07-31T00:00:02.000Z",
        entryRef: null,
        purgeReceiptRef: "purge-old-reset",
        purgeScope: "space",
        purgeState: "purged",
        resultKind: "purge",
      },
      state: "succeeded",
    })

    expect(stalePurge.entries).toEqual([newest])
    expect(stalePurge.selectedEntry).toEqual(newest)
    expect(stalePurge.generation).toBe(current.generation)
    expect(stalePurge.spacePurge).toBeNull()
  })

  test("clears every owner projection not authorized by a higher committed command version", () => {
    const other = entry({ entryRef: "entry-2", content: "Unobserved owner plaintext" })
    const current = {
      ...controllerState(),
      entries: [entry(), other],
      history: historyPage("entry-1", "1", [{
        content: "Old history plaintext",
        reason: "explicit",
        recordedAt: "2026-07-31T00:00:00.000Z",
        restorable: true,
        revision: 1,
        revisionRef: "revision-old",
        state: "available",
        supersedesRevisionRef: null,
        validFrom: null,
        validTo: null,
      }]).items,
      settings: {
        automaticLearning: { availability: "unavailable_until_memory_m3", effective: false, policyReason: null, requested: false },
        observedAt: "2026-07-31T00:00:00.000Z",
        pastChatReference: { availability: "unavailable_until_session_m1a", effective: false, policyReason: null, requested: false },
        revision: "1",
        savedMemoryUse: { availability: "available", effective: true, policyReason: null, requested: true },
      },
    } satisfies MemoryControllerState
    const settings = { ...current.settings!, revision: "2", observedAt: "2026-07-31T00:00:02.000Z" }

    const projected = projectMemoryCommand(current, {
      command: {
        commandId: "5".repeat(32),
        commandKind: "updateMemorySettings",
        receiptRef: "receipt-settings-new-owner",
        receivedAt: "2026-07-31T00:00:01.000Z",
        updatedAt: "2026-07-31T00:00:02.000Z",
      },
      committedSpaceVersion: "2",
      result: { resultKind: "settings", settings },
      state: "succeeded",
    })

    expect(projected).toMatchObject({
      currentOwnerSnapshot: null,
      entries: [],
      generation: current.generation + 1,
      history: [],
      minimumSpaceVersion: "2",
      nextCursor: null,
      selectedEntry: null,
      selectedEntryRef: null,
      settings,
    })
  })

  test("advances the read epoch for every succeeded entry or list owner mutation", () => {
    const command = (commandKind: MemoryCommandResponse["command"]["commandKind"], suffix: string) => ({
      commandId: suffix.repeat(32),
      commandKind,
      receiptRef: `receipt-${suffix}`,
      receivedAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:01.000Z",
    })
    const responses: readonly MemoryCommandResponse[] = [
      ...(["rememberMemoryEntry", "correctMemoryEntry", "prioritizeMemoryEntry", "deprioritizeMemoryEntry"] as const)
        .map((commandKind, index) => ({
          command: command(commandKind, String(index + 1)),
          committedSpaceVersion: String(index + 2),
          result: { entry: entry({ entryVersion: String(index + 2) }), resultKind: "entry" as const },
          state: "succeeded" as const,
        })),
      {
        command: command("restoreMemoryEntryRevision", "5"),
        committedSpaceVersion: "6",
        result: {
          entry: entry({ currentRevisionRef: "revision-2", entryVersion: "2", revision: 2 }),
          newRevision: 2,
          newRevisionRef: "revision-2",
          restoredFromRevisionRef: "revision-1",
          resultKind: "restored",
        },
        state: "succeeded",
      },
      {
        command: command("forgetMemoryEntry", "6"),
        committedSpaceVersion: "7",
        result: {
          effectiveAt: "2026-07-31T00:00:01.000Z",
          entryRef: "entry-1",
          purgeReceiptRef: "purge-entry-1",
          purgeScope: "entry",
          purgeState: "revoked_purge_pending",
          resultKind: "purge",
        },
        state: "succeeded",
      },
    ]

    const projected = responses.map((response) => projectMemoryCommand(controllerState(), response))
    expect(projected.map(({ generation }) => generation))
      .toEqual(responses.map(() => controllerState().generation + 1))
    expect(projected.map(({ nextCursor }) => nextCursor)).toEqual(responses.map(() => null))
  })

  test("does not settle a selected detail below the current list owner version", () => {
    const currentEntry = entry({ entryVersion: "4", revision: 4, currentRevisionRef: "revision-4" })
    const loading = { ...controllerState(), entries: [currentEntry], selectedEntry: null }
    const staleDetail = entry({ entryVersion: "3", revision: 3, currentRevisionRef: "revision-3" })

    expect(settleMemorySelection(loading, loading.generation, { entry: staleDetail, observedSpaceVersion: "3" }, historyPage("entry-1", "3"))).toBe(loading)
  })

  test("promotes a newer entry revision inside an already-observed owner version without inventing page membership", () => {
    const newerDetail = entry({
      content: "Newest detail",
      currentRevisionRef: "revision-4",
      entryVersion: "4",
      revision: 4,
      updatedAt: "2026-07-31T00:00:04.000Z",
    })
    const listed = {
      ...controllerState(),
      currentOwnerSnapshot: ownerSnapshot("4"),
      minimumSpaceVersion: "4",
      selectedEntry: null,
    }
    const listedResult = settleMemorySelection(listed, listed.generation, { entry: newerDetail, observedSpaceVersion: "4" }, historyPage("entry-1", "4"))
    expect(listedResult.entries).toEqual([newerDetail])
    expect(listedResult.entryOwnerKnowledge).toContainEqual({
      entryRef: "entry-1",
      entryVersion: "4",
      state: "active",
    })

    const unlisted = {
      ...controllerState(),
      currentOwnerSnapshot: ownerSnapshot("4"),
      entries: [entry({ entryRef: "entry-2" })],
      minimumSpaceVersion: "4",
      selectedEntry: null,
    }
    const unlistedResult = settleMemorySelection(unlisted, unlisted.generation, { entry: newerDetail, observedSpaceVersion: "4" }, historyPage("entry-1", "4"))
    expect(unlistedResult.entries.map(({ entryRef }) => entryRef)).toEqual(["entry-2"])
    expect(unlistedResult.entryOwnerKnowledge).toContainEqual({
      entryRef: "entry-1",
      entryVersion: "4",
      state: "active",
    })
  })

  test("clears every unobserved plaintext projection when detail observes a newer owner version", () => {
    const current = {
      ...controllerState(),
      entries: [entry(), entry({ entryRef: "entry-2", content: "Potentially revoked elsewhere" })],
      history: [{
        content: "Old revision plaintext",
        reason: "explicit" as const,
        recordedAt: "2026-07-31T00:00:00.000Z",
        restorable: true,
        revision: 1,
        revisionRef: "revision-old",
        state: "available" as const,
        supersedesRevisionRef: null,
        validFrom: null,
        validTo: null,
      }],
    }
    const observed = entry({ entryVersion: "2", revision: 2, currentRevisionRef: "revision-2" })
    const settled = settleMemorySelection(
      current,
      current.generation,
      { entry: observed, observedSpaceVersion: "2" },
      historyPage("entry-1", "2"),
    )

    expect(settled.entries).toEqual([])
    expect(settled.selectedEntry).toEqual(observed)
    expect(settled.currentOwnerSnapshot).toBeNull()
    expect(settled.minimumSpaceVersion).toBe("2")
  })

  test("projects a non-active selected detail as a revoked list tombstone", () => {
    const current = {
      ...controllerState(),
      entries: [entry(), entry({ entryRef: "entry-2", content: "Unobserved old-owner plaintext" })],
    }
    const revoked = {
      entryRef: "entry-1",
      purgeReceiptRef: "purge-selected-detail",
      revokedAt: "2026-07-31T00:00:05.000Z",
      state: "revoked_purge_pending",
    } as const
    const settled = settleMemorySelection(current, current.generation, { entry: revoked, observedSpaceVersion: "5" }, historyPage("entry-1", "5"))

    expect(settled.entries).toEqual([])
    expect(settled.entryOwnerKnowledge).toContainEqual({ entryRef: "entry-1", state: "revoked" })
    expect(settled.nextCursor).toBeNull()
    expect(settled.selectedEntry).toEqual(revoked)
  })

  test("clears A synchronously and ignores A after a deep-link switch to B", () => {
    const loadingB = beginMemorySelection(controllerState(), "entry-2")
    expect(loadingB).toMatchObject({ generation: 5, selectedEntryRef: "entry-2", selectedEntry: null, history: [] })
    expect(settleMemorySelection(loadingB, 4, { entry: entry(), observedSpaceVersion: "1" }, historyPage("entry-1", "1"))).toBe(loadingB)
    expect(settleMemorySelection(loadingB, 5, { entry: entry({ entryRef: "entry-2" }), observedSpaceVersion: "1" }, historyPage("entry-2", "1"))).toMatchObject({
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
      committedSpaceVersion: "2",
      result: { resultKind: "entry", entry: entry({ prioritized: true, entryVersion: "2" }) },
    } satisfies MemoryCommandResponse
    const prioritized = projectMemoryCommand(controllerState(), priority)
    expect(prioritized.entries[0]?.prioritized).toBe(true)

    const purge = {
      state: "succeeded",
      command: { commandId: "b".repeat(32), commandKind: "forgetMemoryEntry", receiptRef: "receipt-2", receivedAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-07-31T00:00:01.000Z" },
      committedSpaceVersion: "3",
      result: { resultKind: "purge", effectiveAt: "2026-07-31T00:00:01.000Z", entryRef: "entry-1", purgeReceiptRef: "purge-1", purgeScope: "entry", purgeState: "revoked_purge_pending" },
    } satisfies MemoryCommandResponse
    const forgotten = projectMemoryCommand(prioritized, purge)
    expect(forgotten.entries).toEqual([])
    expect(forgotten.selectedEntry).toMatchObject({ state: "revoked_purge_pending", purgeReceiptRef: "purge-1" })
    expect(forgotten).toMatchObject({
      generation: prioritized.generation + 1,
      history: [],
      historyNextCursor: null,
      nextCursor: null,
    })

    const exportResult = {
      state: "succeeded",
      command: { commandId: "c".repeat(32), commandKind: "requestMemoryExport", receiptRef: "receipt-3", receivedAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-07-31T00:00:01.000Z" },
      committedSpaceVersion: "3",
      result: { resultKind: "export", export: { artifactDownloadRequest: null, expiresAt: null, exportRef: "export-1", failureCode: null, format: "kokoro_memory_export_v1", requestedAt: "2026-07-31T00:00:00.000Z", state: "queued", statusVersion: "1", updatedAt: "2026-07-31T00:00:01.000Z" } },
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
      committedSpaceVersion: "2",
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
      committedSpaceVersion: purgeState === "purged" ? "3" : "2",
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
        statusVersion: "1",
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
      committedSpaceVersion: "2",
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
        committedSpaceVersion: "2",
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
        committedSpaceVersion: "2",
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
        committedSpaceVersion: "2",
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

  test("accepts a current first page that legitimately omits the changed entry", () => {
    const target = entry({ entryVersion: "2", prioritized: true })
    const current = { ...controllerState(), entries: [target], selectedEntry: target }
    const changed = entry({ entryVersion: "3", prioritized: false })
    const projected = projectMemoryCommand(current, {
      command: {
        commandId: "8".repeat(32),
        commandKind: "deprioritizeMemoryEntry",
        receiptRef: "receipt-depriority",
        receivedAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:01.000Z",
      },
      committedSpaceVersion: "3",
      result: { entry: changed, resultKind: "entry" },
      state: "succeeded",
    })
    const other = entry({ entryRef: "entry-2", entryVersion: "4", prioritized: true })

    const reconciled = reconcileMemoryOwnerPage({
      currentEntries: projected.entries,
      currentOwnerSnapshot: projected.currentOwnerSnapshot,
      incomingEntries: [other],
      incomingOwnerSnapshot: ownerSnapshot("3", "snapshot:after-depriority"),
      minimumSpaceVersion: projected.minimumSpaceVersion,
      ownerKnowledge: projected.entryOwnerKnowledge,
      pageMode: "first",
      retainEntryRefs: ["entry-1"],
    })

    expect(reconciled).not.toBeNull()
    expect(reconciled?.entries).toEqual([other])
    expect(reconciled?.minimumSpaceVersion).toBe("3")
    expect(reconciled?.currentOwnerSnapshot).toEqual(ownerSnapshot("3", "snapshot:after-depriority"))
  })

  test("rejects pages below the scope floor and continuations outside the current owner snapshot", () => {
    const currentSnapshot = ownerSnapshot("5", "snapshot:current")
    const input = {
      currentEntries: [entry()],
      currentOwnerSnapshot: currentSnapshot,
      incomingEntries: [entry({ entryRef: "entry-2" })],
      minimumSpaceVersion: "5",
      ownerKnowledge: [{ entryRef: "entry-1", entryVersion: "1", state: "active" as const }],
      pageMode: "continuation" as const,
      retainEntryRefs: [] as readonly string[],
    }

    expect(reconcileMemoryOwnerPage({ ...input, incomingOwnerSnapshot: ownerSnapshot("4", "snapshot:old") })).toBeNull()
    expect(reconcileMemoryOwnerPage({ ...input, incomingOwnerSnapshot: ownerSnapshot("5", "snapshot:other") })).toBeNull()
    expect(reconcileMemoryOwnerPage({ ...input, incomingOwnerSnapshot: currentSnapshot })?.entries.map(({ entryRef }) => entryRef))
      .toEqual(["entry-1", "entry-2"])
  })

  test("compacts historical owner knowledge after a current first page without weakening the version floor", () => {
    const historicalEntries = Array.from({ length: 500 }, (_, index) => entry({ entryRef: `entry-${index + 1}` }))
    const historicalKnowledge = historicalEntries.map(({ entryRef, entryVersion }) => ({ entryRef, entryVersion, state: "active" as const }))
    historicalKnowledge.push({ entryRef: "entry-revoked", state: "revoked" } as never)
    const currentPage = Array.from({ length: 50 }, (_, index) => entry({ entryRef: `current-${index + 1}` }))

    const reconciled = reconcileMemoryOwnerPage({
      currentEntries: historicalEntries,
      currentOwnerSnapshot: ownerSnapshot("8", "snapshot:historical"),
      incomingEntries: currentPage,
      incomingOwnerSnapshot: ownerSnapshot("9", "snapshot:current"),
      minimumSpaceVersion: "9",
      ownerKnowledge: historicalKnowledge,
      pageMode: "first",
      retainEntryRefs: [],
    })

    expect(reconciled?.entries).toHaveLength(50)
    expect(reconciled?.entryOwnerKnowledge).toHaveLength(50)
    expect(reconciled?.entryOwnerKnowledge.some(({ entryRef }) => entryRef === "entry-revoked")).toBe(false)
    expect(reconcileMemoryOwnerPage({
      currentEntries: reconciled?.entries ?? [],
      currentOwnerSnapshot: reconciled?.currentOwnerSnapshot ?? null,
      incomingEntries: [entry({ entryRef: "entry-revoked" })],
      incomingOwnerSnapshot: ownerSnapshot("8", "snapshot:stale"),
      minimumSpaceVersion: reconciled?.minimumSpaceVersion ?? null,
      ownerKnowledge: reconciled?.entryOwnerKnowledge ?? [],
      pageMode: "first",
      retainEntryRefs: [],
    })).toBeNull()
  })

  test("keeps history continuations inside the exact owner snapshot and space-version floor", () => {
    const first = reconcileMemoryHistoryPage({
      currentHistory: [],
      currentHistoryOwnerSnapshot: null,
      incomingPage: historyPage("entry-1", "5"),
      minimumSpaceVersion: "5",
      pageMode: "first",
    })
    expect(first?.currentHistoryOwnerSnapshot).toEqual(ownerSnapshot("5", "history-snapshot:5"))
    expect(reconcileMemoryHistoryPage({
      currentHistory: first?.history ?? [],
      currentHistoryOwnerSnapshot: first?.currentHistoryOwnerSnapshot ?? null,
      incomingPage: { ...historyPage("entry-1", "5"), ownerSnapshot: ownerSnapshot("5", "history-snapshot:other") },
      minimumSpaceVersion: first?.minimumSpaceVersion ?? null,
      pageMode: "continuation",
    })).toBeNull()
    expect(reconcileMemoryHistoryPage({
      currentHistory: first?.history ?? [],
      currentHistoryOwnerSnapshot: first?.currentHistoryOwnerSnapshot ?? null,
      incomingPage: historyPage("entry-1", "4"),
      minimumSpaceVersion: first?.minimumSpaceVersion ?? null,
      pageMode: "continuation",
    })).toBeNull()
  })

  test("keeps transfer projections monotonic and promotes completed import owner version", () => {
    const queuedExport = {
      artifactDownloadRequest: null,
      expiresAt: null,
      exportRef: "export-1",
      failureCode: null,
      format: "kokoro_memory_export_v1",
      requestedAt: "2026-07-31T00:00:00.000Z",
      state: "queued",
      statusVersion: "1",
      updatedAt: "2026-07-31T00:00:00.000Z",
    } as const
    const readyExport = {
      ...queuedExport,
      artifactDownloadRequest: {
        artifactRef: "artifact:memory-1",
        artifactVersionRef: "version:memory-1",
        deliveryRequestRef: "delivery:memory-1",
        purpose: "export",
      },
      expiresAt: "2026-08-01T00:00:00.000Z",
      state: "ready",
      statusVersion: "2",
      updatedAt: "2026-07-31T00:00:01.000Z",
    } as const
    const ready = settleMemoryExportRefresh(
      { ...controllerState(), exports: [queuedExport] },
      controllerState().generation,
      readyExport,
    )
    expect(ready.exports[0]?.state).toBe("ready")
    expect(settleMemoryExportRefresh(ready, ready.generation, queuedExport)).toBe(ready)

    const completedImport = {
      acceptedEntryCount: 2,
      assetRef: "asset:memory-1",
      assetVersionRef: "version:memory-1",
      format: "kokoro_memory_export_v1",
      importRef: "import-1",
      rejectedEntryCount: 0,
      requestedAt: "2026-07-31T00:00:00.000Z",
      resultingSpaceVersion: "9",
      safeStatusCode: null,
      state: "completed",
      statusVersion: "4",
      updatedAt: "2026-07-31T00:00:02.000Z",
    } as const
    const completed = settleMemoryImportRefresh(controllerState(), controllerState().generation, completedImport)
    expect(completed).toMatchObject({
      currentOwnerSnapshot: null,
      entries: [],
      generation: controllerState().generation + 1,
      minimumSpaceVersion: "9",
      nextCursor: null,
    })
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
        committedSpaceVersion: "2",
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
        committedSpaceVersion: "2",
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
