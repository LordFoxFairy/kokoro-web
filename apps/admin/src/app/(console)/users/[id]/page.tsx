import { notFound } from 'next/navigation'
import { fixtureUsers } from '@/lib/fixtures/data'
import { DetailPage } from '@/components/data/detail-page'

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = fixtureUsers.find((item) => item.id === id)
  if (!user) notFound()
  return (
    <DetailPage
      backHref='/users'
      backLabel='返回用户列表'
      title={user.displayName}
      subtitle={user.email}
      status={user.status}
      fields={[
        { label: '用户 ID', value: user.id },
        { label: '邮箱', value: user.email },
        {
          label: '创建时间',
          value: new Date(user.createdAt).toLocaleString('zh-CN'),
        },
        {
          label: '更新时间',
          value: new Date(user.updatedAt).toLocaleString('zh-CN'),
        },
      ]}
    />
  )
}
