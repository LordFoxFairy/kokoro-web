import { AccessForm } from '@/components/access/access-form'

export default function AccessPage() {
  return (
    <main id='content' className='flex flex-1 flex-col gap-5 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>权限诊断</h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          提交主体、作用域、资源和动作，查看 IAM 返回的权威授权结果
        </p>
      </div>
      <AccessForm />
    </main>
  )
}
