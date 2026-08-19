import { notFound } from 'next/navigation'
import { fixtureOrganizations } from '@/lib/fixtures/data'
import { DetailPage } from '@/components/data/detail-page'

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const organization = fixtureOrganizations.find((item) => item.id === id)
  if (!organization) notFound()
  return (
    <DetailPage
      backHref='/organizations'
      backLabel='返回组织列表'
      title={organization.name}
      subtitle={organization.slug}
      status={organization.status}
      fields={[
        { label: '组织 ID', value: organization.id },
        { label: '唯一标识', value: organization.slug },
        {
          label: '创建时间',
          value: new Date(organization.createdAt).toLocaleString('zh-CN'),
        },
        {
          label: '更新时间',
          value: new Date(organization.updatedAt).toLocaleString('zh-CN'),
        },
      ]}
    />
  )
}
