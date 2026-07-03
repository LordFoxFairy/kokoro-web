import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
} from "react"
import { createPortal } from "react-dom"

import { CollapseIcon, SendIcon } from "@/ui/icons/composer"

import styles from "./composer.module.css"

type ExpandDialogProps = {
  draft: string
  onDraftChange: (value: string) => void
  canSend: boolean
  // 与内联输入框同一上限，双向一致把关。
  maxLength: number
  // 复用 composer 的表单提交；调用方负责收起面板。
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

// 放大编辑面板：portal 到 body，position:fixed 覆盖全屏，不受 composer 盒模型/层叠影响。
// 点击遮罩空白处 / Esc / 收起键关闭；长文场景下 Enter 换行、⌘/Ctrl+Enter 发送。
export function ExpandDialog({
  draft,
  onDraftChange,
  canSend,
  maxLength,
  onSubmit,
  onClose,
}: ExpandDialogProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // 打开时聚焦大编辑框并把光标移到末尾，直接续写。
  useEffect(() => {
    const node = inputRef.current
    if (!node) {
      return
    }
    node.focus()
    const end = node.value.length
    node.setSelectionRange(end, end)
  }, [])

  // 放大编辑是长文场景：Enter 换行；⌘/Ctrl+Enter 才发送；Esc 收起。
  // 与内联输入框（Enter 直接发送）不同，因为大面板的本意就是从容地写多行。
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return createPortal(
    <div
      className={styles.expandBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <form
        className={styles.expand}
        role="dialog"
        aria-modal="true"
        aria-label="放大编辑"
        onSubmit={onSubmit}
      >
        <div className={styles.expandHead}>
          <span className={styles.expandTitle}>放大编辑</span>
          <button
            type="button"
            className={styles.expandCollapse}
            aria-label="收起放大编辑"
            onClick={onClose}
          >
            <CollapseIcon className={styles.expandGlyph} />
          </button>
        </div>

        <textarea
          ref={inputRef}
          className={styles.expandInput}
          aria-label="放大编辑输入"
          placeholder="把想说的告诉我。"
          maxLength={maxLength}
          value={draft}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            onDraftChange(event.target.value)
          }}
          onKeyDown={onKeyDown}
        />

        <div className={styles.expandFoot}>
          <span className={styles.expandHint}>⌘ / Ctrl + Enter 发送 · Esc 收起</span>
          <button className={styles.send} type="submit" aria-label="发送消息" disabled={!canSend}>
            <SendIcon className={styles.glyph} />
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
