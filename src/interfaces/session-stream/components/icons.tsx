type IconProps = {
  className?: string
}

export function PanelIcon({ className = "kk-rail__icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <line x1="9.5" y1="4" x2="9.5" y2="20" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

export function PlusIcon({ className = "kk-rail__icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function SearchIcon({ className = "kk-rail__icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <line x1="20" y1="20" x2="16.2" y2="16.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function ChatsIcon({ className = "kk-rail__icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v3A2.5 2.5 0 0 1 13.5 12H8l-4 3.5V6.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 14.5a2.5 2.5 0 0 0 2.5 2.5H16l4 3v-9A2.5 2.5 0 0 0 17.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function FolderIcon({ className = "kk-rail__icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h3.2a2 2 0 0 1 1.5.7l1 1.2h7.3a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function ArtifactsIcon({ className = "kk-rail__icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="4.5" width="9" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="14.5" cy="14.5" r="5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function CodeIcon({ className = "kk-rail__icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m9 8-4 4 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m15 8 4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function BriefcaseIcon({ className = "kk-rail__icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 7.5V6.2A1.7 1.7 0 0 1 10.7 4.5h2.6A1.7 1.7 0 0 1 15 6.2v1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function PaletteIcon({ className = "kk-rail__icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 4a8 8 0 0 0 0 16c1.3 0 1.8-1 1.4-2-.4-1 .2-1.8 1.3-1.8H17a3 3 0 0 0 3-3 8 8 0 0 0-8-9.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="8.5" cy="11" r="1" fill="currentColor" />
      <circle cx="12" cy="8.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="11" r="1" fill="currentColor" />
    </svg>
  )
}

export function SlidersIcon({ className = "kk-rail__icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <line x1="8.5" y1="5" x2="8.5" y2="19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="15.5" y1="5" x2="15.5" y2="19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8.5" cy="9" r="2" fill="var(--background)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15.5" cy="15" r="2" fill="var(--background)" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

// 助手头像：机器人(头 + 天线 + 双眼)，比抽象的「心」更直观表达 AI 身份。
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

// 用户头像：占位人形，给右侧消息一个对称的身份标识。
export function UserIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8.4" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.6 19.2a6.4 6.4 0 0 1 12.8 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// 麦克风：明确的话筒造型，避免之前的 ◉ 被误认成停止/暂停键。
export function MicIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 11a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="12" y1="17" x2="12" y2="20.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

// 发送：上箭头。
export function SendIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <line x1="12" y1="20" x2="12" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// 停止生成：实心圆角方块（与发送的箭头明确区分）。
export function StopIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" />
    </svg>
  )
}

// 下拉指示小箭头。
export function ChevronIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// 选中勾。
export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// 放大编辑：向两角外扩的对角双箭头（对齐 Gemini 输入框右上角的展开图标）。
export function ExpandIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 5h5v5" />
      <path d="M10 19H5v-5" />
      <path d="M19 5l-6.5 6.5" />
      <path d="M5 19l6.5-6.5" />
    </svg>
  )
}

// 收起放大编辑：向中心内收的对角双箭头。
export function CollapseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 9h-5V4" />
      <path d="M5 15h5v5" />
      <path d="M14 10l5-5" />
      <path d="M10 14l-5 5" />
    </svg>
  )
}

// 起始 chips 图标：与图标集统一的细线风格（currentColor），替代之前的彩色 emoji。
// 学习课件：摊开的书。
export function BookIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 6.4C10.4 5 7.9 4.6 4.5 5.1v12c3.4-.5 5.9-.1 7.5 1.3" />
      <path d="M12 6.4C13.6 5 16.1 4.6 19.5 5.1v12c-3.4-.5-5.9-.1-7.5 1.3" />
      <line x1="12" y1="6.4" x2="12" y2="18.4" />
    </svg>
  )
}

// 写一封信：信封。
export function MailIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M4.2 7.2l7.8 5.6 7.8-5.6" />
    </svg>
  )
}

// 想法可视化：灯泡。
export function BulbIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3a5.5 5.5 0 0 0-3.3 9.9c.5.4.8 1 .8 1.6v.5h5v-.5c0-.6.3-1.2.8-1.6A5.5 5.5 0 0 0 12 3Z" />
      <line x1="9.6" y1="18" x2="14.4" y2="18" />
      <line x1="10.6" y1="20.5" x2="13.4" y2="20.5" />
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

// Fast 模式：闪电（更快回应）。
export function ZapIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 2 4 13.5h6L11 22l9-11.5h-6L13 2Z" />
    </svg>
  )
}

// 模式锁定：选定后本轮对话不可再切换。
export function LockIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
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

// todo 已完成：圆 + 勾。
export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.4 12.3l2.4 2.4 4.8-5.2" />
    </svg>
  )
}

export function BanCircleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M6.3 6.3l11.4 11.4" />
    </svg>
  )
}
