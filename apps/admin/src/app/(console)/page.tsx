import {
  Activity,
  Building2,
  CircleCheck,
  ShieldAlert,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const metrics = [
  { label: '用户', value: '2,481', note: '2,316 个活跃账号', icon: Users },
  { label: '组织', value: '86', note: '覆盖 142 个 Site', icon: Building2 },
  { label: '活跃会话', value: '418', note: '过去 15 分钟', icon: Activity },
  { label: '待处理事件', value: '7', note: '3 项需要关注', icon: ShieldAlert },
] as const

const events = [
  ['用户状态变更', 'Ada Chen', '用户 usr_4821', '成功', '2 分钟前'],
  ['角色权限更新', '平台管理员', 'Site 管理员', '成功', '18 分钟前'],
  ['会话撤销', 'Ming Zhao', '会话 ses_91af', '成功', '36 分钟前'],
  ['访问被拒绝', 'service-console', 'audit.export', '拒绝', '1 小时前'],
] as const

export default function DashboardPage() {
  return (
    <main id='content' className='flex flex-1 flex-col gap-6 p-4 md:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold tracking-normal'>管理概览</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            平台身份、访问与安全运行状态
          </p>
        </div>
        <Badge variant='outline' className='gap-1.5 py-1'>
          <CircleCheck aria-hidden='true' />
          服务正常
        </Badge>
      </div>

      <section
        aria-label='关键指标'
        className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'
      >
        {metrics.map((metric) => (
          <Card key={metric.label} className='rounded-lg shadow-none'>
            <CardHeader className='flex flex-row items-center justify-between pb-2'>
              <CardTitle className='text-sm font-medium text-muted-foreground'>
                {metric.label}
              </CardTitle>
              <metric.icon
                aria-hidden='true'
                className='text-muted-foreground'
              />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-semibold'>{metric.value}</div>
              <p className='mt-1 text-xs text-muted-foreground'>
                {metric.note}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section aria-labelledby='recent-audit-heading' className='min-w-0'>
        <div className='mb-3 flex items-end justify-between gap-3'>
          <div>
            <h2 id='recent-audit-heading' className='text-base font-semibold'>
              最近审计
            </h2>
            <p className='text-sm text-muted-foreground'>
              关键管理操作与访问结果
            </p>
          </div>
        </div>
        <div className='overflow-hidden rounded-lg border bg-background'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>操作</TableHead>
                <TableHead>操作者</TableHead>
                <TableHead>对象</TableHead>
                <TableHead>结果</TableHead>
                <TableHead className='text-right'>时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map(([action, actor, target, result, time]) => (
                <TableRow key={`${action}-${time}`}>
                  <TableCell className='font-medium'>{action}</TableCell>
                  <TableCell>{actor}</TableCell>
                  <TableCell className='text-muted-foreground'>
                    {target}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={result === '成功' ? 'secondary' : 'destructive'}
                    >
                      {result}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-right text-muted-foreground'>
                    {time}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </main>
  )
}
