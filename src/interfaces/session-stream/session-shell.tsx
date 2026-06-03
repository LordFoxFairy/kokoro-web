"use client"

import { useEffect, useState } from "react"

import {
  consumeLiveSession,
  createPreviewSessionState,
  demoSessionId,
  type LiveSessionHandle,
  resolveSessionBaseUrl,
} from "@/application/session-stream-preview"
import type { SessionStreamState } from "@/application/session-stream-reducer"

export function SessionShell() {
  const [state, setState] = useState<SessionStreamState>(() =>
    createPreviewSessionState(),
  )
  const [transportLabel, setTransportLabel] = useState("preview fallback")

  useEffect(() => {
    if (typeof fetch === "undefined") {
      return
    }

    let disposed = false
    let handle: LiveSessionHandle = { close: () => {} }

    const connectSession = async () => {
      try {
        handle = await consumeLiveSession({
          input: "hello kokoro",
          sessionId: demoSessionId,
          onState: (snapshot) => {
            if (!disposed) {
              setState(snapshot)
            }
          },
        })

        if (disposed) {
          handle.close()
          return
        }

        setTransportLabel(`live replay · ${resolveSessionBaseUrl()}`)
      } catch {
        if (!disposed) {
          setTransportLabel("preview fallback")
        }
      }
    }

    void connectSession()

    return () => {
      disposed = true
      handle.close()
    }
  }, [])

  return (
    <main
      className="kk-shell"
      data-run-status={state.runStatus}
      data-transport-label={transportLabel}
    >
      <aside className="kk-rail" aria-label="会话导航">
        <div className="kk-rail__brand">
          <div className="kk-rail__brand-mark" aria-hidden>
            心
          </div>
          <div>
            <p className="kk-rail__brand-title">Kokoro</p>
            <p className="kk-rail__brand-subtitle">こころ</p>
          </div>
        </div>

        <button className="kk-rail__action kk-rail__new-chat" type="button">
          <span aria-hidden>＋</span>
          <span>新对话</span>
        </button>

        <button className="kk-rail__action kk-rail__search" type="button">
          <span className="kk-rail__search-label">
            <span aria-hidden>⌕</span>
            <span>搜索</span>
          </span>
          <span className="kk-rail__search-shortcut">⌘K</span>
        </button>

        <div className="kk-rail__user-card">
          <div className="kk-rail__user-avatar" aria-hidden />
          <div>
            <p className="kk-rail__user-name">当前用户</p>
            <p className="kk-rail__user-meta">placeholder</p>
          </div>
        </div>
      </aside>

      <section className="kk-shell__main">
        <div className="kk-shell__hero">
          <h1 className="kk-shell__headline">今天想做什么？</h1>
          <p className="kk-shell__subhead">不急，先把想法说给我</p>
        </div>

        <div className="kk-shell__composer-wrap">
          <form className="kk-composer" aria-label="开始新对话">
            <button className="kk-composer__add" type="button" aria-label="附加内容">
              <span aria-hidden>＋</span>
            </button>

            <div className="kk-composer__input-copy">把想说的告诉我。</div>

            <button className="kk-composer__mode" type="button" aria-label="切换模式">
              <span>Fast</span>
              <span aria-hidden>▾</span>
            </button>

            <button className="kk-composer__mic" type="button" aria-label="语音输入">
              <span aria-hidden>◉</span>
            </button>

            <button className="kk-composer__send" type="button" aria-label="发送消息">
              <span aria-hidden>↑</span>
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}
