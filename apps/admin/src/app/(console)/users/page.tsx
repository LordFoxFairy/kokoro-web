import { fixtureUsers } from '@/lib/fixtures/data'
import { DataPage, statusLabel } from '@/components/data/data-page'

export default function UsersPage() {
  return (
    <DataPage
      title='用户管理'
      description='管理平台账号、状态、成员关系与角色分配'
      actionLabel='创建用户'
      searchPlaceholder='搜索姓名或邮箱'
      columns={['用户', '邮箱', '状态', '更新时间']}
      rows={fixtureUsers.map((user) => ({
        id: user.id,
        cells: [
          { text: user.displayName, href: `/users/${user.id}` },
          { text: user.email },
          { text: statusLabel(user.status), status: user.status },
          { text: new Date(user.updatedAt).toLocaleString('zh-CN') },
        ],
      }))}
    />
  )
}
