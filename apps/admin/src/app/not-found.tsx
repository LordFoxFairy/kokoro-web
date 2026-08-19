import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className='grid min-h-[70svh] place-items-center p-6 text-center'>
      <div>
        <p className='text-sm font-medium text-muted-foreground'>404</p>
        <h1 className='mt-2 text-2xl font-semibold'>页面不存在</h1>
        <p className='mt-2 text-sm text-muted-foreground'>
          该地址不存在，或对应资源已经被移除。
        </p>
        <Button asChild className='mt-5'>
          <Link href='/'>返回概览</Link>
        </Button>
      </div>
    </main>
  )
}
