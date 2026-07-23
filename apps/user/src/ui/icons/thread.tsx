// 会话线/过程/todo 域图标：细线风格，颜色随 currentColor。

type IconProps = {
  className?: string
}

// 下拉/展开指示小箭头（thread/composer/todo 共用）。
export function ChevronIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// 思考：四角星「灵感/推理」标记，代表智能体的内心独白。
export function SparkIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5c.6 3.7 1.8 4.9 5.5 5.5-3.7.6-4.9 1.8-5.5 5.5-.6-3.7-1.8-4.9-5.5-5.5 3.7-.6 4.9-1.8 5.5-5.5Z" />
      <path d="M18.5 14.5c.3 1.6.8 2.1 2.4 2.4-1.6.3-2.1.8-2.4 2.4-.3-1.6-.8-2.1-2.4-2.4 1.6-.3 2.1-.8 2.4-2.4Z" />
    </svg>
  )
}

// 工具调用：扳手（Lucide wrench）。
export function WrenchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
    </svg>
  )
}

// 子智能体：机器人（头 + 天线 + 双眼）。
export function RobotIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4.5" y="8.5" width="15" height="10.5" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <line x1="12" y1="4.6" x2="12" y2="8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="3.6" r="1.3" fill="currentColor" />
      <circle cx="9.4" cy="13.6" r="1.2" fill="currentColor" />
      <circle cx="14.6" cy="13.6" r="1.2" fill="currentColor" />
    </svg>
  )
}

// 完成：圆 + 勾（工具/子智能体/todo 共用）。
export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.4 12.3l2.4 2.4 4.8-5.2" />
    </svg>
  )
}

// 已拒绝：禁止圈（用户驳回，非失败）。
export function BanCircleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M6.3 6.3l11.4 11.4" />
    </svg>
  )
}

// todo 待办：空心圆。
export function CircleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

// todo 进行中：圆环 + 实心圆心。
export function DotCircleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.4" fill="currentColor" />
    </svg>
  )
}

// 成果（delivery）：文件页 + 完成小勾——冻结结论的「拿走什么」标记。
export function DeliveryIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.5 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5l-5-5Z" />
      <path d="M13.5 3.5v5h5" />
      <path d="M9.2 14.6l1.9 1.9 3.7-4" />
    </svg>
  )
}

// 计划条标题：勾选清单。
export function ChecklistIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3.5 6.3l1.5 1.5 2.7-2.8" />
      <path d="M3.5 13.3l1.5 1.5 2.7-2.8" />
      <line x1="11" y1="6.5" x2="20.5" y2="6.5" />
      <line x1="11" y1="13.5" x2="20.5" y2="13.5" />
      <line x1="4" y1="20" x2="20.5" y2="20" />
    </svg>
  )
}
