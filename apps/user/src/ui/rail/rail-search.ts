// 侧栏「最近」列表条目与本地过滤（纯函数，规格可测）。

export type ConversationSummary = {
  id: string
  title: string
}

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
