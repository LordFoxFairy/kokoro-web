import Link from 'next/link'
import { ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ForbiddenPage() {
  return (
    <main
      id='content'
      className='grid flex-1 place-items-center p-6 text-center'
    >
      <div className='max-w-md'>
        <ShieldX
          aria-hidden='true'
          className='mx-auto mb-4 text-muted-foreground'
        />
        <h1 className='text-2xl font-semibold'>无权访问</h1>
        <p className='mt-2 text-sm text-muted-foreground'>
          当前账号没有访问此管理功能所需的权限。
        </p>
        <Button asChild className='mt-5'>
          <Link href='/'>返回概览</Link>
        </Button>
      </div>
    </main>
  )
}
