// 侧栏域图标：细线风格，颜色随 currentColor。

type IconProps = {
  className?: string
}

export function PanelIcon({ className }: IconProps) {
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

export function PlusIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <line x1="20" y1="20" x2="16.2" y2="16.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function ChatsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v3A2.5 2.5 0 0 1 13.5 12H8l-4 3.5V6.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 14.5a2.5 2.5 0 0 0 2.5 2.5H16l4 3v-9A2.5 2.5 0 0 0 17.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function CoinIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14.5 9.2a3 3 0 0 0-2.5-1.2c-1.7 0-3 1.8-3 4s1.3 4 3 4a3 3 0 0 0 2.5-1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function SlidersIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <line x1="8.5" y1="5" x2="8.5" y2="19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="15.5" y1="5" x2="15.5" y2="19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8.5" cy="9" r="2" fill="var(--background)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15.5" cy="15" r="2" fill="var(--background)" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
