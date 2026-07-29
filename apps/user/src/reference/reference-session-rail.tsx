"use client"

import { type FormEvent, useState } from "react"

import type {
  ReferenceSessionOrganizer,
  ReferenceSessionOrganizerState,
} from "./reference-session-organizer"
import styles from "./reference-session-rail.module.css"

export function ReferenceSessionRail(props: {
  readonly activeSessionId: string | null
  readonly available: boolean
  readonly brandName: string
  readonly controller: ReferenceSessionOrganizer
  readonly onNew: () => void
  readonly onOpen: (sessionId: string) => void
  readonly state: ReferenceSessionOrganizerState
}) {
  const [search, setSearch] = useState("")
  const [newFolderName, setNewFolderName] = useState("")
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [folderName, setFolderName] = useState("")
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null)
  const disabled = !props.available || props.state.pendingAction !== null

  const submitSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void props.controller.setQuery(search)
  }
  const submitFolder = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const name = newFolderName.trim()
    if (!name) return
    setNewFolderName("")
    void props.controller.createFolder(name)
  }
  const submitRename = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const id = renamingFolderId
    const name = folderName.trim()
    if (id === null || !name) return
    setRenamingFolderId(null)
    setFolderName("")
    void props.controller.renameFolder(id, name)
  }

  return (
    <aside className={styles.rail} aria-label="Chats and folders">
      <header className={styles.header}>
        <div className={styles.brandMark} aria-hidden>心</div>
        <div>
          <strong>{props.brandName}</strong>
          <span>こころ</span>
        </div>
      </header>

      <button className={styles.newChat} type="button" onClick={props.onNew} disabled={disabled}>
        <span aria-hidden>＋</span> New chat
      </button>

      <form className={styles.search} role="search" onSubmit={submitSearch}>
        <input
          aria-label="Search chats"
          maxLength={512}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search server history"
          value={search}
        />
        <button type="submit" disabled={disabled}>Search</button>
      </form>

      <nav className={styles.filters} aria-label="Chat filters">
        <button
          aria-current={props.state.filter.kind === "all" ? "page" : undefined}
          type="button"
          onClick={() => void props.controller.setFilter({ kind: "all" })}
        >All chats</button>
        <button
          aria-current={props.state.filter.kind === "pinned" ? "page" : undefined}
          type="button"
          onClick={() => void props.controller.setFilter({ kind: "pinned" })}
        >Pinned</button>
      </nav>

      <section className={styles.folderSection} aria-labelledby="folder-heading">
        <div className={styles.sectionHeading}>
          <h2 id="folder-heading">Folders</h2>
        </div>
        <form className={styles.addFolder} onSubmit={submitFolder}>
          <input
            aria-label="New folder name"
            disabled={disabled}
            maxLength={128}
            onChange={(event) => setNewFolderName(event.target.value)}
            placeholder="New folder"
            value={newFolderName}
          />
          <button type="submit" disabled={disabled || newFolderName.trim().length === 0}>Add</button>
        </form>
        <div className={styles.folderList}>
          {props.state.folders.map((folder) => (
            <div className={styles.folderRow} key={folder.folderId}>
              {renamingFolderId === folder.folderId ? (
                <form className={styles.renameFolder} onSubmit={submitRename}>
                  <input
                    autoFocus
                    aria-label={`Rename folder ${folder.name}`}
                    maxLength={128}
                    onChange={(event) => setFolderName(event.target.value)}
                    value={folderName}
                  />
                  <button type="submit" disabled={disabled || folderName.trim().length === 0}>Save</button>
                  <button type="button" onClick={() => setRenamingFolderId(null)}>Cancel</button>
                </form>
              ) : confirmDeleteFolderId === folder.folderId ? (
                <div className={styles.confirmDelete} role="group" aria-label={`Confirm delete folder ${folder.name}`}>
                  <span>Delete folder?</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setConfirmDeleteFolderId(null)
                      void props.controller.deleteFolder(folder.folderId)
                    }}
                  >Confirm</button>
                  <button type="button" onClick={() => setConfirmDeleteFolderId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <button
                    className={styles.folderSelect}
                    aria-current={props.state.filter.kind === "folder" && props.state.filter.folderId === folder.folderId ? "page" : undefined}
                    type="button"
                    onClick={() => void props.controller.setFilter({ kind: "folder", folderId: folder.folderId })}
                  >{folder.name}</button>
                  <button
                    className={styles.iconAction}
                    type="button"
                    aria-label={`Rename folder ${folder.name}`}
                    disabled={disabled}
                    onClick={() => {
                      setRenamingFolderId(folder.folderId)
                      setFolderName(folder.name)
                    }}
                  >✎</button>
                  <button
                    className={styles.iconAction}
                    type="button"
                    aria-label={`Delete folder ${folder.name}`}
                    disabled={disabled}
                    onClick={() => setConfirmDeleteFolderId(folder.folderId)}
                  >×</button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.chatSection} aria-labelledby="chat-heading">
        <div className={styles.sectionHeading}>
          <h2 id="chat-heading">Chats</h2>
          {props.state.phase === "loading" ? <span>Refreshing…</span> : null}
        </div>
        {props.state.failure ? <p className={styles.failure} role="alert">{props.state.failure}</p> : null}
        {props.state.phase === "ready" && props.state.sessions.length === 0 ? (
          <p className={styles.empty}>No chats in this view.</p>
        ) : null}
        <div className={styles.chatList}>
          {props.state.sessions.map((session) => (
            <article
              className={styles.chatRow}
              data-active={session.sessionId === props.activeSessionId ? "true" : undefined}
              key={session.sessionId}
            >
              <button
                className={styles.chatSelect}
                type="button"
                aria-current={session.sessionId === props.activeSessionId ? "page" : undefined}
                onClick={() => props.onOpen(session.sessionId)}
              >
                <strong>{session.title}</strong>
                <span>{new Date(session.updatedAt).toLocaleString()}</span>
              </button>
              <button
                className={styles.pin}
                type="button"
                aria-label={`${session.pinned ? "Unpin" : "Pin"} ${session.title}`}
                aria-pressed={session.pinned}
                disabled={disabled}
                onClick={() => void props.controller.togglePinned(session.sessionId)}
              >{session.pinned ? "★" : "☆"}</button>
              <select
                aria-label={`Move ${session.title} to folder`}
                disabled={disabled}
                onChange={(event) => void props.controller.moveToFolder(session.sessionId, event.target.value || null)}
                value={session.folderId ?? ""}
              >
                <option value="">No folder</option>
                {props.state.folders.map((folder) => (
                  <option key={folder.folderId} value={folder.folderId}>{folder.name}</option>
                ))}
              </select>
            </article>
          ))}
        </div>
        {props.state.nextCursor !== null ? (
          <button
            className={styles.loadMore}
            type="button"
            disabled={props.state.loadingMore}
            onClick={() => void props.controller.loadMore()}
          >{props.state.loadingMore ? "Loading…" : "Load more"}</button>
        ) : null}
      </section>
    </aside>
  )
}
