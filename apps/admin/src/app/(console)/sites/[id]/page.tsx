import { notFound } from 'next/navigation'
import { fixtureSites } from '@/lib/fixtures/data'
import { DetailPage } from '@/components/data/detail-page'

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const site = fixtureSites.find((item) => item.id === id)
  if (!site) notFound()
  return (
    <DetailPage
      backHref='/sites'
      backLabel='返回 Site 列表'
      title={site.name}
      subtitle={site.slug}
      status={site.status}
      fields={[
        { label: 'Site ID', value: site.id },
        { label: '所属组织', value: site.organizationId },
        {
          label: '创建时间',
          value: new Date(site.createdAt).toLocaleString('zh-CN'),
        },
        {
          label: '更新时间',
          value: new Date(site.updatedAt).toLocaleString('zh-CN'),
        },
      ]}
    />
  )
}
