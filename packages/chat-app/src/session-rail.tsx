"use client"

import { type FormEvent, useId, useRef, useState } from "react"

import type {
  SessionOrganizer,
  SessionOrganizerState,
} from "./session-organizer"
import type { ChatProductCopy } from "./chat-copy"
import type { SessionContextPolicy } from "./session-context-policy"
import styles from "./session-rail.module.css"

export function SessionRail(props: {
  readonly activeSessionId: string | null
  readonly available: boolean
  readonly brandName: string
  readonly controller: SessionOrganizer
  readonly copy: ChatProductCopy
  readonly onNew: (contextPolicy: SessionContextPolicy) => void
  readonly onOpen: (sessionId: string) => void
  readonly state: SessionOrganizerState
}) {
  const [search, setSearch] = useState("")
  const [newFolderName, setNewFolderName] = useState("")
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [folderName, setFolderName] = useState("")
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState("")
  const [confirmTrashSessionId, setConfirmTrashSessionId] = useState<string | null>(null)
  const [mobileCollapsed, setMobileCollapsed] = useState(true)
  const navigationId = useId()
  const temporaryDescriptionId = useId()
  const navigationRef = useRef<HTMLDivElement | null>(null)
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
  const submitSessionRename = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const id = renamingSessionId
    const title = sessionTitle.trim()
    if (id === null || !title) return
    setRenamingSessionId(null)
    setSessionTitle("")
    void props.controller.renameSession(id, title)
  }
  const activeView = props.state.filter.kind !== "archived" && props.state.filter.kind !== "trashed"
  const toggleMobileNavigation = (): void => {
    if (!mobileCollapsed) {
      setMobileCollapsed(true)
      return
    }
    setMobileCollapsed(false)
    window.requestAnimationFrame(() => {
      navigationRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus()
    })
  }
  const newChat = (contextPolicy: SessionContextPolicy): void => {
    setMobileCollapsed(true)
    props.onNew(contextPolicy)
  }
  const openChat = (sessionId: string): void => {
    setMobileCollapsed(true)
    props.onOpen(sessionId)
  }

  return (
    <aside className={styles.rail} aria-label="Chats and folders">
      <header className={styles.header}>
        <div className={styles.brandMark} aria-hidden>✦</div>
        <div className={styles.brandText}>
          <strong>{props.brandName}</strong>
          <span>{props.copy.workspaceLabel}</span>
        </div>
        <button
          aria-controls={navigationId}
          aria-expanded={!mobileCollapsed}
          aria-label={mobileCollapsed ? props.copy.openChatNavigation : props.copy.closeChatNavigation}
          className={styles.mobileToggle}
          onClick={toggleMobileNavigation}
          type="button"
        >{mobileCollapsed ? "☰" : "×"}</button>
      </header>

      <div
        className={styles.railBody}
        data-mobile-collapsed={mobileCollapsed}
        id={navigationId}
        ref={navigationRef}
      >
      <div className={styles.newSessionActions}>
        <button className={styles.newChat} type="button" onClick={() => newChat("standard")} disabled={disabled}>
          <span aria-hidden>＋</span> {props.copy.newChat}
        </button>
        <button
          aria-describedby={temporaryDescriptionId}
          className={styles.temporaryChat}
          disabled={disabled}
          onClick={() => newChat("temporary")}
          type="button"
        >{props.copy.temporaryChat}</button>
        <p id={temporaryDescriptionId}>{props.copy.temporaryChatDescription}</p>
      </div>

      <form className={styles.search} role="search" onSubmit={submitSearch}>
        <input
          aria-label={props.copy.searchChats}
          maxLength={512}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={props.copy.searchChats}
          value={search}
        />
        <button type="submit" disabled={disabled}>{props.copy.search}</button>
      </form>

      <nav className={styles.filters} aria-label="Chat filters">
        <button
          aria-current={props.state.filter.kind === "all" ? "page" : undefined}
          type="button"
          onClick={() => void props.controller.setFilter({ kind: "all" })}
        >{props.copy.allChats}</button>
        <button
          aria-current={props.state.filter.kind === "pinned" ? "page" : undefined}
          type="button"
          onClick={() => void props.controller.setFilter({ kind: "pinned" })}
        >{props.copy.pinned}</button>
        <button
          aria-current={props.state.filter.kind === "archived" ? "page" : undefined}
          type="button"
          onClick={() => void props.controller.setFilter({ kind: "archived" })}
        >{props.copy.archived}</button>
        <button
          aria-current={props.state.filter.kind === "trashed" ? "page" : undefined}
          type="button"
          onClick={() => void props.controller.setFilter({ kind: "trashed" })}
        >{props.copy.trash}</button>
      </nav>

      <section className={styles.folderSection} aria-labelledby="folder-heading">
        <div className={styles.sectionHeading}>
          <h2 id="folder-heading">{props.copy.folders}</h2>
        </div>
        <form className={styles.addFolder} onSubmit={submitFolder}>
          <input
            aria-label="New folder name"
            disabled={disabled}
            maxLength={128}
            onChange={(event) => setNewFolderName(event.target.value)}
            placeholder={props.copy.newFolder}
            value={newFolderName}
          />
          <button type="submit" disabled={disabled || newFolderName.trim().length === 0}>{props.copy.add}</button>
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
          <h2 id="chat-heading">{props.copy.chats}</h2>
          {props.state.phase === "loading" ? <span>Refreshing…</span> : null}
        </div>
        {props.state.failure ? <p className={styles.failure} role="alert">{props.state.failure}</p> : null}
        {props.state.phase === "ready" && props.state.sessions.length === 0 ? (
          <p className={styles.empty}>{props.copy.noChats}</p>
        ) : null}
        <div className={styles.chatList}>
          {props.state.sessions.map((session) => (
            <article
              className={styles.chatRow}
              data-active={session.sessionId === props.activeSessionId ? "true" : undefined}
              key={session.sessionId}
            >
              {renamingSessionId === session.sessionId ? (
                <form className={styles.renameSession} onSubmit={submitSessionRename}>
                  <input
                    autoFocus
                    aria-label={`${props.copy.renameChat} ${session.title}`}
                    maxLength={256}
                    onChange={(event) => setSessionTitle(event.target.value)}
                    value={sessionTitle}
                  />
                  <button type="submit" disabled={disabled || sessionTitle.trim().length === 0}>Save</button>
                  <button type="button" onClick={() => setRenamingSessionId(null)}>Cancel</button>
                </form>
              ) : confirmTrashSessionId === session.sessionId ? (
                <div className={styles.confirmTrash} role="group" aria-label={`${props.copy.confirmTrash} ${session.title}`}>
                  <span>{props.copy.confirmTrash}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setConfirmTrashSessionId(null)
                      void props.controller.trashSession(session.sessionId)
                    }}
                  >Confirm</button>
                  <button type="button" onClick={() => setConfirmTrashSessionId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <button
                    className={styles.chatSelect}
                    type="button"
                    aria-current={session.sessionId === props.activeSessionId ? "page" : undefined}
                    onClick={() => openChat(session.sessionId)}
                  >
                    <strong>{session.title}</strong>
                    <span>{new Date(session.updatedAt).toLocaleString()}</span>
                  </button>
                  {activeView ? (
                    <button
                      className={styles.pin}
                      type="button"
                      aria-label={`${session.pinned ? "Unpin" : "Pin"} ${session.title}`}
                      aria-pressed={session.pinned}
                      disabled={disabled}
                      onClick={() => void props.controller.togglePinned(session.sessionId)}
                    >{session.pinned ? "★" : "☆"}</button>
                  ) : null}
                  <div className={styles.chatActions}>
                    {activeView ? (
                      <>
                        <button type="button" disabled={disabled} onClick={() => {
                          setRenamingSessionId(session.sessionId)
                          setSessionTitle(session.title)
                        }}>{props.copy.renameChat}</button>
                        <button type="button" disabled={disabled} onClick={() => void props.controller.archiveSession(session.sessionId)}>{props.copy.archiveChat}</button>
                        <button type="button" disabled={disabled} onClick={() => setConfirmTrashSessionId(session.sessionId)}>{props.copy.trashChat}</button>
                      </>
                    ) : (
                      <button type="button" disabled={disabled} onClick={() => void props.controller.restoreSession(session.sessionId)}>{props.copy.restoreChat}</button>
                    )}
                  </div>
                  {activeView ? (
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
                  ) : null}
                </>
              )}
            </article>
          ))}
        </div>
        {props.state.nextCursor !== null ? (
          <button
            className={styles.loadMore}
            type="button"
            disabled={props.state.loadingMore}
            onClick={() => void props.controller.loadMore()}
          >{props.state.loadingMore ? "Loading…" : props.copy.loadMore}</button>
        ) : null}
      </section>
      </div>
    </aside>
  )
}
