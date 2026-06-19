import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
} from "react"
import { createPortal } from "react-dom"

import { MAX_INPUT_LENGTH } from "./composer-input"
import { CollapseIcon, SendIcon } from "../icons"

type ExpandDialogProps = {
  draft: string
  onDraftChange: (value: string) => void
  canSend: boolean
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
      className="kk-expand__backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <form
        className="kk-expand"
        role="dialog"
        aria-modal="true"
        aria-label="放大编辑"
        onSubmit={onSubmit}
      >
        <div className="kk-expand__head">
          <span className="kk-expand__title">放大编辑</span>
          <button
            type="button"
            className="kk-expand__collapse"
            aria-label="收起放大编辑"
            onClick={onClose}
          >
            <CollapseIcon className="kk-composer__expand-glyph" />
          </button>
        </div>

        <textarea
          ref={inputRef}
          className="kk-expand__input"
          aria-label="放大编辑输入"
          placeholder="把想说的告诉我。"
          maxLength={MAX_INPUT_LENGTH}
          value={draft}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            onDraftChange(event.target.value)
          }}
          onKeyDown={onKeyDown}
        />

        <div className="kk-expand__foot">
          <span className="kk-expand__hint">⌘ / Ctrl + Enter 发送 · Esc 收起</span>
          <button
            className="kk-composer__send"
            type="submit"
            aria-label="发送消息"
            disabled={!canSend}
          >
            <SendIcon className="kk-composer__glyph" />
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
