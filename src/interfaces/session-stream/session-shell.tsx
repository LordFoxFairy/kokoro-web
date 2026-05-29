"use client"

import dynamic from "next/dynamic"

import { applySessionEvent, createSessionStreamState } from "@/application/session-stream-reducer"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

import { seedEvents } from "./seed-events"

const ArtifactPreview = dynamic(
  () => import("./artifact-preview").then((mod) => mod.ArtifactPreview),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-[#6b5b4a]">Loading artifact preview.</p>
    ),
  },
)

export function SessionShell() {
  const state = seedEvents.reduce(applySessionEvent, createSessionStreamState())

  return (
    <main className="min-h-screen bg-[#faf7f2] px-6 py-10 text-[#2b2520]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <Card>
          <CardHeader className="space-y-3 border-b border-[#f3ead6] pb-6">
            <p className="text-sm uppercase tracking-[0.28em] text-[#8b6f47]">
              Kokoro / session stream preview
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-[#2b2520]">
              Protocol-first chat shell for AGUI + SSE replay.
            </h1>
            <CardDescription className="max-w-2xl">
              先把协议收敛逻辑锁住，再把真实 session transport 接上来，避免浏览器层背负
              Redis 与 agent 细节。
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            <div className="flex items-center justify-between rounded-2xl bg-[#fbf6ec] px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-[#8b6f47]">
                  run status
                </p>
                <p className="mt-1 text-sm text-[#6b5b4a]">
                  replay reducer folds duplicate and terminal events.
                </p>
              </div>
              <span className="rounded-full bg-white px-4 py-2 text-sm font-medium text-[#8b6f47] shadow-sm">
                {state.runStatus}
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {state.messages.map((message) => (
                <article
                  key={message.id}
                  className={cn(
                    "rounded-3xl border px-5 py-4 shadow-sm",
                    message.role === "assistant"
                      ? "border-[#ebe0cf] bg-[#fffdf9]"
                      : "border-[#d8e0cf] bg-[#f7faf3]",
                  )}
                >
                  <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#8b6f47]">
                    {message.role}
                  </p>
                  <p className="text-sm leading-7 text-[#2b2520]">
                    {message.content}
                  </p>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-[#f3ead6] pb-5">
            <p className="text-xs uppercase tracking-[0.24em] text-[#8b6f47]">
              Artifact lane
            </p>
            <CardTitle>A2UI artifact preview</CardTitle>
            <CardDescription>
              当前先用静态 v0.9 surface 证明渲染边界存在，后续再切到真实 SSE message
              feed。
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <div className="rounded-3xl bg-[#fbf6ec] p-4">
              <ArtifactPreview />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
