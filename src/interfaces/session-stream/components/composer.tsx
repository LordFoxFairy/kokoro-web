import type { ChangeEvent, FormEvent, KeyboardEvent, RefObject } from "react"

import {
  MAX_INPUT_LENGTH,
  resizeComposer,
} from "../hooks/use-conversation"

type ComposerProps = {
  draft: string
  onDraftChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  isStreaming: boolean
  canSend: boolean
  onStop: () => void
  transportLabel: string
  composerRef: RefObject<HTMLTextAreaElement | null>
}

export function Composer({
  draft,
  onDraftChange,
  onKeyDown,
  onSubmit,
  isStreaming,
  canSend,
  onStop,
  transportLabel,
  composerRef,
}: ComposerProps) {
  return (
    <div className="kk-shell__composer-wrap">
      <form
        className="kk-composer"
        aria-label="消息编辑区"
        onSubmit={onSubmit}
      >
        <button
          className="kk-composer__add"
          type="button"
          aria-label="附加内容"
        >
          <span aria-hidden>＋</span>
        </button>

        <textarea
          ref={composerRef}
          className="kk-composer__input"
          aria-label="对话输入"
          placeholder="把想说的告诉我。"
          rows={1}
          maxLength={MAX_INPUT_LENGTH}
          value={draft}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            onDraftChange(event.target.value)
            resizeComposer(event.currentTarget)
          }}
          onKeyDown={onKeyDown}
          disabled={isStreaming}
        />

        <button
          className="kk-composer__mode"
          type="button"
          aria-label="切换模式"
        >
          <span>Fast</span>
          <span aria-hidden>▾</span>
        </button>

        <button className="kk-composer__mic" type="button" aria-label="语音输入">
          <span aria-hidden>◉</span>
        </button>

        {isStreaming ? (
          <button
            className="kk-composer__send kk-composer__send--stop"
            type="button"
            aria-label="停止生成"
            onClick={onStop}
          >
            <span aria-hidden>■</span>
          </button>
        ) : (
          <button
            className="kk-composer__send"
            type="submit"
            aria-label="发送消息"
            disabled={!canSend}
          >
            <span aria-hidden>↑</span>
          </button>
        )}
      </form>

      {/* 常驻保留高度：标签延后出现也不改变 composer 位置，避免聊天框跳动。 */}
      <p className="kk-shell__transport">{transportLabel}</p>
    </div>
  )
}
