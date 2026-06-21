// 新对话快捷键 ⇧⌘O（mac）/ ⇧Ctrl O（其它平台）：与侧栏展示的提示一致，避免显示一个不工作的键位。
export function isNewChatShortcut(event: {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "o"
  )
}
