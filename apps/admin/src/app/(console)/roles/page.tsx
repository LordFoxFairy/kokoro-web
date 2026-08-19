import { fixtureRoles } from '@/lib/fixtures/data'
import { DataPage, statusLabel } from '@/components/data/data-page'

export default function RolesPage() {
  return (
    <DataPage
      title='角色与权限'
      description='按作用域管理角色、权限集合与成员使用情况'
      actionLabel='创建角色'
      searchPlaceholder='搜索角色名称'
      columns={['角色', '作用域', '权限数', '成员数', '状态']}
      rows={fixtureRoles.map((role) => ({
        id: role.id,
        cells: [
          { text: role.name },
          {
            text:
              role.scope.type === 'platform'
                ? '平台'
                : `${role.scope.type}: ${role.scope.id}`,
          },
          { text: String(role.permissionKeys.length) },
          { text: String(role.memberCount) },
          { text: statusLabel(role.status), status: role.status },
        ],
      }))}
    />
  )
}
