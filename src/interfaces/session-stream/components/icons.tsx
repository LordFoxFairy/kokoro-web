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
