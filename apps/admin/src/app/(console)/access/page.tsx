import { SearchCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function AccessPage() {
  return (
    <main id='content' className='flex flex-1 flex-col gap-5 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>权限诊断</h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          提交主体、作用域、资源和动作，查看 IAM 返回的权威授权结果
        </p>
      </div>
      <Card className='max-w-3xl rounded-lg shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>访问检查</CardTitle>
        </CardHeader>
        <CardContent>
          <form className='grid gap-4 sm:grid-cols-2'>
            <Input name='subject' aria-label='主体 ID' placeholder='主体 ID' />
            <Input
              name='scope'
              aria-label='作用域 ID'
              placeholder='作用域 ID'
            />
            <Input
              name='resource'
              aria-label='资源'
              placeholder='资源，例如 users'
            />
            <Input
              name='action'
              aria-label='动作'
              placeholder='动作，例如 read'
            />
            <div className='sm:col-span-2'>
              <Button type='submit'>
                <SearchCheck data-icon='inline-start' aria-hidden='true' />
                执行检查
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
