import type { ConversationSummary } from "../hooks/use-conversation"

// 最近会话的客户端过滤：按标题大小写不敏感子串匹配；空/纯空白查询返回全部。
export function filterConversations(
  conversations: ConversationSummary[],
  query: string,
): ConversationSummary[] {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return conversations
  }
  return conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(needle),
  )
}
