"use client"

import { useState } from "react"
import { A2uiSurface } from "@a2ui/react/v0_9"
import { Sidebar } from "./sidebar"
import { Composer } from "./composer"
import { useA2uiSurface } from "@/interfaces/a2ui/use-a2ui-surface"

function makeSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ses_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
  }
  return "ses_demo"
}

export function ChatPage() {
  const [run, setRun] = useState<{ text: string; sessionId: string } | null>(null)
  const { surface } = useA2uiSurface(run ?? { text: "", sessionId: "" })

  return (
    <div className="kk-app">
      <Sidebar />
      <main className="kk-main">
        {!run && (
          <div className="kk-empty">
            <h1 className="kk-empty__title">今天想做<span className="kk-empty__accent">什么</span>？</h1>
            <p className="kk-empty__sub">不急，先把想法说给我。</p>
          </div>
        )}
        <div className="kk-conversation">
          {surface && <A2uiSurface surface={surface} />}
        </div>
        <div className="kk-composer-dock">
          <Composer onSend={(text) => setRun({ text, sessionId: makeSessionId() })} />
        </div>
      </main>
    </div>
  )
}
