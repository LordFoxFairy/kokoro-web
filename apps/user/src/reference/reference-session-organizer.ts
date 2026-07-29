import type { SessionClient } from "@kokoro/session-client"
import type {
  FolderView,
  SessionCommandResponse,
  SessionListItem,
} from "@kokoro/session-client/contracts"

import {
  createReferenceCommandIdentity,
  reconcileReferenceCommandReceipt,
} from "./reference-command"

export type ReferenceSessionEntry = Readonly<{
  sessionId: string
  title: string
  updatedAt: string
  pinned: boolean
  folderId: string | null
  preferenceVersion: number
}>

export type ReferenceSessionFolder = Readonly<{
  folderId: string
  name: string
  version: number
}>

export type ReferenceSessionFilter =
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "pinned" }>
  | Readonly<{ kind: "folder"; folderId: string }>

export type ReferenceSessionOrganizerState = Readonly<{
  phase: "idle" | "loading" | "ready"
  sessions: readonly ReferenceSessionEntry[]
  folders: readonly ReferenceSessionFolder[]
  filter: ReferenceSessionFilter
  query: string
  nextCursor: string | null
  loadingMore: boolean
  pendingAction: string | null
  failure: string | null
}>

type OrganizerClient = Pick<
  SessionClient,
  | "listSessions"
  | "getCommandReceipt"
  | "putPreference"
  | "listFolders"
  | "createFolder"
  | "updateFolder"
  | "deleteFolder"
>

export type ReferenceSessionOrganizer = Readonly<{
  getSnapshot(): ReferenceSessionOrganizerState
  subscribe(listener: () => void): () => void
  load(): Promise<void>
  refresh(): Promise<void>
  loadMore(): Promise<void>
  setQuery(query: string): Promise<void>
  setFilter(filter: ReferenceSessionFilter): Promise<void>
  togglePinned(sessionId: string): Promise<void>
  moveToFolder(sessionId: string, folderId: string | null): Promise<void>
  createFolder(name: string): Promise<void>
  renameFolder(folderId: string, name: string): Promise<void>
  deleteFolder(folderId: string): Promise<void>
  close(): void
}>

const INITIAL: ReferenceSessionOrganizerState = Object.freeze({
  phase: "idle",
  sessions: Object.freeze([]),
  folders: Object.freeze([]),
  filter: Object.freeze({ kind: "all" }),
  query: "",
  nextCursor: null,
  loadingMore: false,
  pendingAction: null,
  failure: null,
})

function sessionEntry(item: SessionListItem): ReferenceSessionEntry {
  return Object.freeze({
    sessionId: item.session.session_id,
    title: item.session.title,
    updatedAt: item.session.updated_at,
    pinned: item.pinned,
    folderId: item.folder_id ?? null,
    preferenceVersion: item.preference_version,
  })
}

function folderEntry(folder: FolderView): ReferenceSessionFolder {
  return Object.freeze({
    folderId: folder.folder_id,
    name: folder.name,
    version: folder.version,
  })
}

function normalizedName(value: string): string | null {
  const name = value.trim()
  return name.length > 0 && name.length <= 128 ? name : null
}

function mutationFailure(
  operation: "put_preference" | "create_folder" | "update_folder" | "delete_folder",
  response: SessionCommandResponse,
): string | null {
  const receipt = response.command_receipt
  if (receipt.status === "accepted" || receipt.status === "applied") return null
  if (receipt.status === "pending" || receipt.status === "outcome_unknown") {
    return "The change is still being reconciled. The server view was refreshed; try again if it does not appear."
  }
  if (receipt.payload.code === "SESSION_VERSION_CONFLICT") {
    return "This item changed in another window. The current server version was refreshed; review it and try again."
  }
  if (operation === "delete_folder") {
    return "The folder was not deleted. Move its chats out first, or refresh and retry if the folder changed elsewhere."
  }
  return receipt.payload.message
}

export function createReferenceSessionOrganizer(options: {
  readonly client: OrganizerClient
  readonly projectRef: string | null
}): ReferenceSessionOrganizer {
  let state = INITIAL
  let closed = false
  let requestGeneration = 0
  const listeners = new Set<() => void>()

  const publish = (next: ReferenceSessionOrganizerState): void => {
    if (closed) return
    state = Object.freeze(next)
    for (const listener of listeners) listener()
  }

  const listFolders = async (): Promise<readonly ReferenceSessionFolder[]> => {
    const projectRef = options.projectRef
    if (projectRef === null) return Object.freeze([])
    const folders: ReferenceSessionFolder[] = []
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    for (let pageCount = 0; pageCount < 100; pageCount += 1) {
      const page = await options.client.listFolders({ project_ref: projectRef, limit: 100, ...(cursor ? { cursor } : {}) })
      folders.push(...page.folders.map(folderEntry))
      if (page.next_cursor === undefined) return Object.freeze(folders)
      if (seenCursors.has(page.next_cursor)) throw new Error("Folder pagination cursor repeated")
      seenCursors.add(page.next_cursor)
      cursor = page.next_cursor
    }
    throw new Error("Folder pagination exceeded the bounded page limit")
  }

  const listSessions = async (
    cursor?: string,
    filterOverride?: ReferenceSessionFilter,
  ) => {
    const projectRef = options.projectRef
    if (projectRef === null) return { sessions: Object.freeze([]) as readonly ReferenceSessionEntry[], nextCursor: null }
    const query = state.query.trim()
    const filter = filterOverride ?? state.filter
    const page = await options.client.listSessions({
      project_ref: projectRef,
      limit: 50,
      sort: "updated_desc",
      ...(query ? { q: query } : {}),
      ...(filter.kind === "pinned" ? { pinned: true } : {}),
      ...(filter.kind === "folder" ? { folder_id: filter.folderId } : {}),
      ...(cursor ? { cursor } : {}),
    })
    return {
      sessions: Object.freeze(page.sessions.map(sessionEntry)),
      nextCursor: page.next_cursor ?? null,
    }
  }

  const reload = async (failureAfter: string | null = null): Promise<void> => {
    const generation = ++requestGeneration
    if (options.projectRef === null) {
      publish({ ...state, phase: "ready", sessions: [], folders: [], nextCursor: null, failure: failureAfter })
      return
    }
    publish({ ...state, phase: "loading", loadingMore: false, failure: null })
    try {
      const [initialSessionPage, folders] = await Promise.all([listSessions(), listFolders()])
      let sessionPage = initialSessionPage
      if (closed || generation !== requestGeneration) return
      const currentFilter = state.filter
      const filter = currentFilter.kind === "folder" && !folders.some(({ folderId }) => folderId === currentFilter.folderId)
        ? Object.freeze({ kind: "all" as const })
        : currentFilter
      // A folder can disappear between the two reads. Never label a folder-filtered page as "All chats".
      if (filter !== currentFilter) {
        sessionPage = await listSessions(undefined, filter)
        if (closed || generation !== requestGeneration) return
      }
      publish({
        ...state,
        phase: "ready",
        sessions: sessionPage.sessions,
        folders,
        filter,
        nextCursor: sessionPage.nextCursor,
        loadingMore: false,
        failure: failureAfter,
      })
    } catch {
      if (closed || generation !== requestGeneration) return
      publish({
        ...state,
        phase: "ready",
        loadingMore: false,
        failure: "Chats and folders could not be refreshed. Check the connection and try again.",
      })
    }
  }

  const runMutation = async (
    pendingAction: string,
    operation: "put_preference" | "create_folder" | "update_folder" | "delete_folder",
    effect: Readonly<Record<string, unknown>>,
    send: (command: Awaited<ReturnType<typeof createReferenceCommandIdentity>>) => Promise<SessionCommandResponse>,
  ): Promise<void> => {
    if (state.pendingAction !== null || options.projectRef === null) return
    publish({ ...state, pendingAction, failure: null })
    let failure: string | null = null
    try {
      const command = await createReferenceCommandIdentity(effect)
      const response = await reconcileReferenceCommandReceipt(
        options.client,
        await send(command),
        command,
        operation,
      )
      failure = mutationFailure(operation, response)
    } catch {
      failure = "The change could not be confirmed. The server view was refreshed before another attempt."
    }
    if (closed) return
    await reload(failure)
    if (!closed) publish({ ...state, pendingAction: null })
  }

  const findSession = (sessionId: string): ReferenceSessionEntry | null =>
    state.sessions.find((entry) => entry.sessionId === sessionId) ?? null
  const findFolder = (folderId: string): ReferenceSessionFolder | null =>
    state.folders.find((entry) => entry.folderId === folderId) ?? null

  const setPreference = async (
    session: ReferenceSessionEntry,
    next: Readonly<{ pinned: boolean; folderId: string | null }>,
  ): Promise<void> => {
    if (next.folderId !== null && findFolder(next.folderId) === null) return
    const effect = {
      expected_version: session.preferenceVersion,
      pinned: next.pinned,
      folder_id: next.folderId,
    }
    await runMutation(`preference:${session.sessionId}`, "put_preference", effect, (command) =>
      options.client.putPreference(session.sessionId, {
        command,
        expected_version: session.preferenceVersion,
        pinned: next.pinned,
        folder_id: next.folderId,
      }))
  }

  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    load: () => reload(),
    refresh: () => reload(),
    async loadMore() {
      const cursor = state.nextCursor
      if (cursor === null || state.loadingMore || state.phase !== "ready") return
      const generation = requestGeneration
      publish({ ...state, loadingMore: true, failure: null })
      try {
        const page = await listSessions(cursor)
        if (closed || generation !== requestGeneration) return
        const existing = new Set(state.sessions.map(({ sessionId }) => sessionId))
        publish({
          ...state,
          sessions: Object.freeze([
            ...state.sessions,
            ...page.sessions.filter(({ sessionId }) => !existing.has(sessionId)),
          ]),
          nextCursor: page.nextCursor,
          loadingMore: false,
        })
      } catch {
        if (closed || generation !== requestGeneration) return
        publish({ ...state, loadingMore: false, failure: "More chats could not be loaded. Try again." })
      }
    },
    async setQuery(query) {
      const normalized = query.trim().slice(0, 512)
      if (normalized === state.query) return
      publish({ ...state, query: normalized })
      await reload()
    },
    async setFilter(filter) {
      if (filter.kind === "folder" && findFolder(filter.folderId) === null) return
      if (
        filter.kind === state.filter.kind &&
        (filter.kind !== "folder" || state.filter.kind === "folder" && filter.folderId === state.filter.folderId)
      ) return
      publish({ ...state, filter })
      await reload()
    },
    async togglePinned(sessionId) {
      const session = findSession(sessionId)
      if (session !== null) await setPreference(session, { pinned: !session.pinned, folderId: session.folderId })
    },
    async moveToFolder(sessionId, folderId) {
      const session = findSession(sessionId)
      if (session !== null && session.folderId !== folderId) {
        await setPreference(session, { pinned: session.pinned, folderId })
      }
    },
    async createFolder(name) {
      const projectRef = options.projectRef
      const normalized = normalizedName(name)
      if (projectRef === null || normalized === null) return
      const effect = { project_ref: projectRef, name: normalized }
      await runMutation("folder:create", "create_folder", effect, (command) =>
        options.client.createFolder({ command, project_ref: projectRef, name: normalized }))
    },
    async renameFolder(folderId, name) {
      const folder = findFolder(folderId)
      const normalized = normalizedName(name)
      if (folder === null || normalized === null || normalized === folder.name) return
      const effect = { expected_version: folder.version, name: normalized }
      await runMutation(`folder:${folderId}`, "update_folder", effect, (command) =>
        options.client.updateFolder(folderId, { command, expected_version: folder.version, name: normalized }))
    },
    async deleteFolder(folderId) {
      const folder = findFolder(folderId)
      if (folder === null) return
      const effect = { expected_version: folder.version }
      await runMutation(`folder:${folderId}`, "delete_folder", effect, (command) =>
        options.client.deleteFolder(folderId, { command, expected_version: folder.version }))
    },
    close() {
      closed = true
      requestGeneration += 1
      listeners.clear()
    },
  })
}
