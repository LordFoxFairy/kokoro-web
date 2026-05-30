"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"

type ToolCardProps = {
  toolName: string
  toolCallId: string
  status: "running" | "done"
}

// ChatGPT/Gemini 式工具卡：running 转圈、done 收成完成态；可展开看调用标识。
export function ToolCard({ toolName, toolCallId, status }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false)
  const isDone = status === "done"

  return (
    <div className="kk-soft-panel">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-[var(--brand-wood)]"
      >
        <span aria-hidden>🔧</span>
        <span>{toolName}</span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 text-xs",
            isDone ? "text-[var(--brand-wood)]" : "text-[rgba(43,37,32,0.6)]",
          )}
        >
          {isDone ? (
            <>
              <span aria-hidden>✓</span>
              <span>完成</span>
            </>
          ) : (
            <>
              <span
                aria-hidden
                className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--brand-wood-soft)] border-t-[var(--brand-wood)]"
              />
              <span>运行中</span>
            </>
          )}
        </span>
      </button>

      {expanded ? (
        <p className="kk-copy-muted mt-3 break-all text-xs">
          调用标识 · {toolCallId}
        </p>
      ) : null}
    </div>
  )
}
