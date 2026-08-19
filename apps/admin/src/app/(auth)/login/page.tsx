import { Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  return (
    <main className='grid min-h-svh place-items-center bg-muted/40 p-4'>
      <div className='w-full max-w-sm'>
        <div className='mb-6 flex items-center justify-center gap-2'>
          <span className='flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
            <Shield aria-hidden='true' />
          </span>
          <span className='text-lg font-semibold'>Kokoro 管理控制台</span>
        </div>
        <Card className='rounded-lg shadow-sm'>
          <CardHeader>
            <CardTitle className='text-lg'>登录</CardTitle>
          </CardHeader>
          <CardContent>
            <form className='flex flex-col gap-4'>
              <div className='flex flex-col gap-1.5'>
                <label htmlFor='account' className='text-sm font-medium'>
                  账号
                </label>
                <Input id='account' name='account' autoComplete='username' />
              </div>
              <div className='flex flex-col gap-1.5'>
                <label htmlFor='password' className='text-sm font-medium'>
                  密码
                </label>
                <Input
                  id='password'
                  name='password'
                  type='password'
                  autoComplete='current-password'
                />
              </div>
              <Button type='submit' className='w-full'>
                登录
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
