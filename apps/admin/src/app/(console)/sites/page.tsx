import { fixtureSites } from '@/lib/fixtures/data'
import { DataPage, statusLabel } from '@/components/data/data-page'

export default function SitesPage() {
  return (
    <DataPage
      title='Site 管理'
      description='维护 Site 基础信息及所属组织'
      actionLabel='创建 Site'
      searchPlaceholder='搜索 Site 名称或标识'
      columns={['Site', '标识', '所属组织', '状态']}
      rows={fixtureSites.map((site) => ({
        id: site.id,
        cells: [
          { text: site.name, href: `/sites/${site.id}` },
          { text: site.slug },
          { text: site.organizationId },
          { text: statusLabel(site.status), status: site.status },
        ],
      }))}
    />
  )
}
