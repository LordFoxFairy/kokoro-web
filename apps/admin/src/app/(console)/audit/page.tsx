import { fixtureAudit } from '@/lib/fixtures/data'
import { DataPage, StatusBadge } from '@/components/data/data-page'

export default function AuditPage() {
  return (
    <DataPage
      title='审计日志'
      description='查询管理操作、访问结果与 requestId 关联记录'
      searchPlaceholder='搜索操作、对象或 requestId'
      columns={['操作', '操作者', '对象', '结果', '发生时间']}
      rows={fixtureAudit.map((event) => ({
        id: event.id,
        cells: [
          event.action,
          event.actorId ?? '系统',
          `${event.targetType}${event.targetId ? `: ${event.targetId}` : ''}`,
          <StatusBadge key='status' status={event.outcome} />,
          new Date(event.occurredAt).toLocaleString('zh-CN'),
        ],
      }))}
    />
  )
}
