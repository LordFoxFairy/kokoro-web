// 会话头部标题内联编辑（CONV-UX）：双击进入编辑，Enter/失焦提交，Escape 取消。
// 提交仅在非空且与原题不同时上抛（乐观更新 + 失败回滚由上层 renameConversation 收口）。

import { useEffect, useRef, useState } from "react"

import { useT } from "@/i18n/context"

import styles from "./session-shell.module.css"

type HeaderTitleProps = {
  title: string
  onRename: (title: string) => void
}

export function HeaderTitle({ title, onRename }: HeaderTitleProps) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const start = () => {
    setDraft(title)
    setEditing(true)
  }
  const cancel = () => setEditing(false)
  const commit = () => {
    const value = draft.trim()
    if (value !== "" && value !== title) {
      onRename(value)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.headerTitleInput}
        value={draft}
        maxLength={256}
        aria-label={t("rail.renamePlaceholder")}
        placeholder={t("rail.renamePlaceholder")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commit()
          } else if (event.key === "Escape") {
            event.preventDefault()
            cancel()
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className={styles.headerTitle}
      onDoubleClick={start}
      aria-label={t("rail.renameChat", { title })}
      title={t("rail.renameChat", { title })}
    >
      {title}
    </button>
  )
}
