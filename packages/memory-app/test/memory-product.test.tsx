import type { MemoryEntryActiveView, MemoryRevisionView, MemorySettings } from "@kokoro/site-client"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"

import { MAXIMUM_MEMORY_UTF8_BYTES, MEMORY_REDUCED_MOTION_MEDIA, MemoryView, createMemoryRuntimeScopeFence, destructiveConfirmation, memoryUtf8Bytes, restoreConflictMessage, safeMemoryImportLabel } from "../src/memory-product"

const settings: MemorySettings = {
  automaticLearning: { availability: "unavailable_until_memory_m3", effective: false, policyReason: null, requested: false },
  observedAt: "2026-07-31T00:00:00.000Z",
  pastChatReference: { availability: "unavailable_until_session_m1a", effective: false, policyReason: null, requested: false },
  revision: "1",
  savedMemoryUse: { availability: "available", effective: false, policyReason: "Disabled by this Site policy.", requested: true },
}

const entry: MemoryEntryActiveView = {
  category: "preference",
  content: "Prefer concise answers",
  createdAt: "2026-07-31T00:00:00.000Z",
  currentRevisionRef: "revision-2",
  entryRef: "entry-1",
  entryVersion: "2",
  prioritized: true,
  revision: 2,
  scopeKind: "user",
  source: { safeLabel: "Saved by you", sourceKind: "explicit", state: "current" },
  state: "active",
  updatedAt: "2026-07-31T00:00:01.000Z",
  validFrom: null,
  validTo: null,
}

const history: MemoryRevisionView[] = [{
  content: "Prefer short answers",
  reason: "explicit",
  recordedAt: "2026-07-30T00:00:00.000Z",
  restorable: true,
  revision: 1,
  revisionRef: "revision-1",
  state: "available",
  supersedesRevisionRef: null,
  validFrom: null,
  validTo: null,
}]

describe("Memory product", () => {
  test("renders independent controls, typed owner states and accessible live status", () => {
    const html = renderToStaticMarkup(<MemoryView
      brandName="Fox Site"
      busy={false}
      entries={[entry]}
      error={null}
      exports={[{ artifactDownloadRequest: null, expiresAt: null, exportRef: "export-1", failureCode: null, format: "kokoro_memory_export_v1", requestedAt: "2026-07-31T00:00:00.000Z", state: "running", statusVersion: "1", updatedAt: "2026-07-31T00:00:01.000Z" }]}
      history={history}
      historyNextCursor={null}
      importProgress={null}
      importSource={{ safeLabel: "memory-export.json" }}
      imports={[{ acceptedEntryCount: 0, assetRef: "asset-1", assetVersionRef: "asset-version-1", format: "kokoro_memory_export_v1", importRef: "import-1", rejectedEntryCount: 0, requestedAt: "2026-07-31T00:00:00.000Z", resultingSpaceVersion: null, safeStatusCode: "awaiting_review", state: "quarantined", statusVersion: "1", updatedAt: "2026-07-31T00:00:01.000Z" }]}
      nextCursor={null}
      onCorrect={vi.fn()}
      onCreate={vi.fn()}
      onDeprioritize={vi.fn()}
      onExport={vi.fn()}
      onForget={vi.fn()}
      onImport={vi.fn()}
      onChooseImportFile={vi.fn()}
      onLoadMore={vi.fn()}
      onLoadMoreHistory={vi.fn()}
      onPrioritize={vi.fn()}
      onReset={vi.fn()}
      onRestore={vi.fn()}
      onSelect={vi.fn()}
      onToggleSavedUse={vi.fn()}
      pendingCommands={[]}
      selectedEntry={entry}
      selectedEntryRef="entry-1"
      settings={settings}
      spacePurge={null}
      status="Memory is current"
    />)
    expect(html).toContain("Fox Site Memory")
    expect(html).toContain("Saved memory")
    expect(html).toContain("Past chats")
    expect(html).toContain("Automatic learning")
    expect(html).toContain("Requested: On")
    expect(html).toContain("Effective: Off")
    expect(html).toContain("Disabled by this Site policy.")
    expect(html).toContain("not available in this release")
    expect(html).toContain("aria-live=\"polite\"")
    expect(html).toContain("aria-current=\"true\"")
    expect(html).toContain("Restore as a new revision")
    expect(html).toContain("Deletion in progress")
    expect(html).toContain("Awaiting review")
    expect(html).not.toContain("<nav")
    expect(html).not.toContain("<script")
  })

  test("requires exact destructive phrases and describes stale restore conflicts", () => {
    expect(destructiveConfirmation("forget", "FORGET")).toBe(true)
    expect(destructiveConfirmation("reset", "RESET ALL MEMORY")).toBe(true)
    expect(destructiveConfirmation("reset", "reset all memory")).toBe(false)
    expect(restoreConflictMessage({ expectedRevision: 1, currentRevision: 2 })).toContain("changed from revision 1 to 2")
  })

  test("exposes keyboard-native controls and reduced-motion styling contract", async () => {
    expect(MEMORY_REDUCED_MOTION_MEDIA).toBe("(prefers-reduced-motion: reduce)")
    const html = renderToStaticMarkup(<MemoryView
      brandName="Fox"
      busy={false}
      entries={[]}
      error={null}
      exports={[]}
      history={[]}
      historyNextCursor={null}
      importProgress={null}
      importSource={null}
      imports={[]}
      nextCursor={null}
      onCorrect={vi.fn()}
      onCreate={vi.fn()}
      onDeprioritize={vi.fn()}
      onExport={vi.fn()}
      onForget={vi.fn()}
      onImport={vi.fn()}
      onChooseImportFile={vi.fn()}
      onLoadMore={vi.fn()}
      onLoadMoreHistory={vi.fn()}
      onPrioritize={vi.fn()}
      onReset={vi.fn()}
      onRestore={vi.fn()}
      onSelect={vi.fn()}
      onToggleSavedUse={vi.fn()}
      pendingCommands={[]}
      selectedEntry={null}
      selectedEntryRef={null}
      settings={settings}
      spacePurge={null}
      status=""
    />)
    expect(html).toContain("<button")
    expect(html).toContain("<label")
    expect(html).toContain("role=\"status\"")
  })

  test("budgets canonical content by UTF-8 bytes rather than UTF-16 characters", () => {
    expect(memoryUtf8Bytes("🦊")).toBe(4)
    expect(memoryUtf8Bytes("a".repeat(MAXIMUM_MEMORY_UTF8_BYTES))).toBe(MAXIMUM_MEMORY_UTF8_BYTES)
    expect(memoryUtf8Bytes("\ud800")).toBeNull()
    expect(safeMemoryImportLabel("  memory\u202e\nexport.json  ")).toBe("memory export.json")
    expect(Array.from(safeMemoryImportLabel("🦊".repeat(200)))).toHaveLength(160)
  })

  test("suppresses a deferred old-Site result after a scope rerender, including A to B to A", async () => {
    const fence = createMemoryRuntimeScopeFence("site-a:user-1")
    const oldScope = fence.capture()
    let release!: (value: string) => void
    const deferred = new Promise<string>((resolve) => { release = resolve })
    let committed = "current"
    const settlement = deferred.then((value) => {
      if (fence.isCurrent(oldScope)) committed = value
    })

    fence.commit("site-b:user-1")
    fence.commit("site-a:user-1")
    release("stale")
    await settlement

    expect(committed).toBe("current")
    expect(fence.isCurrent(oldScope)).toBe(false)
  })
})
