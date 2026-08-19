import { fixtureSessions } from '@/lib/fixtures/data'
import { DataPage, statusLabel } from '@/components/data/data-page'

export default function SessionsPage() {
  return (
    <DataPage
      title='会话管理'
      description='查看登录会话、活动时间与撤销状态'
      searchPlaceholder='搜索用户或客户端'
      columns={['会话', '用户', '客户端', '状态', '最近活动']}
      rows={fixtureSessions.map((session) => ({
        id: session.id,
        cells: [
          { text: session.id },
          { text: session.userId },
          { text: session.clientLabel },
          { text: statusLabel(session.status), status: session.status },
          { text: new Date(session.lastActiveAt).toLocaleString('zh-CN') },
        ],
      }))}
    />
  )
}
