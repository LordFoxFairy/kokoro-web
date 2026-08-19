import Link from 'next/link'
import { ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Main } from '@/components/layout/main'

export default function ForbiddenPage() {
  return (
    <Main fluid className='grid flex-1 place-items-center text-center'>
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
    </Main>
  )
}
