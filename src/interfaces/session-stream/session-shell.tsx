"use client"

import { useEffect, useState } from "react"

import {
  createPreviewSessionState,
  openDemoSessionStream,
  resolveSessionBaseUrl,
  startDemoSession,
} from "@/application/session-stream-preview"
import {
  applySessionEvent,
  createSessionStreamState,
  type SessionStreamState,
} from "@/application/session-stream-reducer"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

import { ArtifactPreview } from "./artifact-preview"

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
    let stopStream = () => {}
    let liveState = createSessionStreamState()

    const connectSession = async () => {
      try {
        await startDemoSession()

        if (disposed) {
          return
        }

        setTransportLabel(`live replay · ${resolveSessionBaseUrl()}`)
        stopStream = openDemoSessionStream((event) => {
          liveState = applySessionEvent(liveState, event)

          if (!disposed) {
            setState(liveState)
          }
        })
      } catch {
        if (!disposed) {
          setTransportLabel("preview fallback")
        }
      }
    }

    void connectSession()

    return () => {
      disposed = true
      stopStream()
    }
  }, [])

  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--foreground)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <Card>
          <CardHeader className="space-y-3 border-b border-[color:var(--brand-wood-soft)] pb-6">
            <p className="kk-eyebrow">Kokoro / session stream</p>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
              Protocol-first chat shell for AGUI + SSE replay.
            </h1>
            <CardDescription className="max-w-2xl">
              先把协议收敛逻辑锁住，再把真实 session transport 接上来，避免浏览器层背负
              Redis 与 agent 细节。
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            <div className="kk-soft-panel flex items-center justify-between gap-4">
              <div>
                <p className="kk-eyebrow">run status</p>
                <p className="kk-copy-muted mt-1">
                  replay reducer folds duplicate and terminal events.
                </p>
              </div>
              <div className="text-right">
                <span className="kk-status-pill">{state.runStatus}</span>
                <p className="kk-copy-muted mt-2 text-xs">{transportLabel}</p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {state.messages.map((message) => (
                <article
                  key={message.id}
                  className={cn(
                    "kk-chat-bubble",
                    message.role === "assistant"
                      ? "kk-chat-bubble--assistant"
                      : "kk-chat-bubble--user",
                  )}
                >
                  <p className="kk-eyebrow mb-2">{message.role}</p>
                  <p className="text-sm leading-7 text-[var(--foreground)]">
                    {message.content}
                  </p>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-[color:var(--brand-wood-soft)] pb-5">
            <p className="kk-eyebrow">Artifact lane</p>
            <CardTitle>A2UI artifact preview</CardTitle>
            <CardDescription>
              当前先用静态 v0.9 surface 证明渲染边界存在，后续再切到真实 SSE message
              feed。
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <div className="kk-a2ui-preview">
              <ArtifactPreview />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
