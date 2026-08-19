import { fixtureOrganizations } from '@/lib/fixtures/data'
import { DataPage, StatusBadge } from '@/components/data/data-page'

export default function OrganizationsPage() {
  return (
    <DataPage
      title='组织管理'
      description='维护组织信息、成员与组织级角色'
      actionLabel='创建组织'
      searchPlaceholder='搜索组织名称或标识'
      columns={['组织', '标识', '状态', '更新时间']}
      rows={fixtureOrganizations.map((organization) => ({
        id: organization.id,
        href: `/organizations/${organization.id}`,
        cells: [
          organization.name,
          organization.slug,
          <StatusBadge key='status' status={organization.status} />,
          new Date(organization.updatedAt).toLocaleString('zh-CN'),
        ],
      }))}
    />
  )
}
