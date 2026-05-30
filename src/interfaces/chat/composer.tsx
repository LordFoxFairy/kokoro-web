"use client"

import { useState } from "react"

// input-pill 输入区（对标原型 .input-pill）。附件/模式 chip 本轮视觉占位。
export function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [value, setValue] = useState("")
  const submit = () => {
    const text = value.trim()
    if (!text) return
    onSend(text)
    setValue("")
  }
  return (
    <div className="kk-composer">
      <button className="kk-composer__attach" type="button" aria-label="附件">＋</button>
      <textarea
        className="kk-composer__field"
        placeholder="把想说的告诉我。"
        value={value}
        rows={1}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <span className="kk-composer__mode">细想</span>
      <button className="kk-composer__send" type="button" aria-label="发送" onClick={submit}>↑</button>
    </div>
  )
}
