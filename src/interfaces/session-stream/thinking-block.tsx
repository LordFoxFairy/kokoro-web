"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"

type ThinkingBlockProps = {
  summary: string
}

// ChatGPT/Gemini 式可折叠思考块：默认折叠，仅露出标题；展开显示摘要文本。
export function ThinkingBlock({ summary }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="kk-soft-panel">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-[var(--brand-wood)]"
      >
        <span aria-hidden>💭</span>
        <span>思考</span>
        <span
          aria-hidden
          className={cn(
            "ml-auto text-xs transition-transform",
            expanded ? "rotate-90" : "rotate-0",
          )}
        >
          ▸
        </span>
      </button>

      {expanded ? (
        <p className="kk-copy-muted mt-3 whitespace-pre-wrap text-sm">
          {summary}
        </p>
      ) : null}
    </div>
  )
}
