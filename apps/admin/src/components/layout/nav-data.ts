import {
  Activity,
  Building2,
  Gauge,
  KeyRound,
  ScrollText,
  ShieldCheck,
  Users,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'

export type ConsoleNavItem = {
  title: string
  href: string
  icon: LucideIcon
  description: string
}

export const consoleNav: readonly ConsoleNavItem[] = [
  {
    title: '概览',
    href: '/',
    icon: Gauge,
    description: '平台运行与安全概况',
  },
  {
    title: '用户',
    href: '/users',
    icon: Users,
    description: '账号、状态与角色分配',
  },
  {
    title: '组织',
    href: '/organizations',
    icon: Building2,
    description: '组织与成员关系',
  },
  {
    title: 'Site',
    href: '/sites',
    icon: Waypoints,
    description: 'Site 基础信息',
  },
  {
    title: '角色权限',
    href: '/roles',
    icon: ShieldCheck,
    description: '角色与细粒度权限',
  },
  {
    title: '权限诊断',
    href: '/access',
    icon: KeyRound,
    description: '查询权威授权结果',
  },
  {
    title: '会话',
    href: '/sessions',
    icon: Activity,
    description: '登录会话与撤销状态',
  },
  {
    title: '审计日志',
    href: '/audit',
    icon: ScrollText,
    description: '操作记录与请求追踪',
  },
]
