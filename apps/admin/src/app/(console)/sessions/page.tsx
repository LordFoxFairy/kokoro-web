import { fixtureSessions } from '@/lib/fixtures/data'
import { DataPage, StatusBadge } from '@/components/data/data-page'

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
          session.id,
          session.userId,
          session.clientLabel,
          <StatusBadge key='status' status={session.status} />,
          new Date(session.lastActiveAt).toLocaleString('zh-CN'),
        ],
      }))}
    />
  )
}
