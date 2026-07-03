import { type ReactNode, useEffect, useId, useRef, useState } from "react"

import { CheckIcon } from "@/ui/icons/composer"

import styles from "./composer.module.css"

export type MenuOption = {
  key: string
  label: string
  hint?: string
  icon?: ReactNode
}

type ComposerMenuProps = {
  triggerClassName: string
  triggerLabel: string
  trigger: ReactNode
  options: MenuOption[]
  // 提供 selectedKey 时为单选菜单，渲染勾选并用 menuitemradio。
  selectedKey?: string
  onSelect: (key: string) => void
  align?: "start" | "end"
}

// 贴在 composer 上方弹出的轻量无障碍菜单：点击外部 / Esc 关闭，单选时显示勾选。
// 不改变 composer 盒模型——菜单为绝对定位的浮层，不挤动其它控件。
export function ComposerMenu({
  triggerClassName,
  triggerLabel,
  trigger,
  options,
  selectedKey,
  onSelect,
  align = "start",
}: ComposerMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointer)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("pointerdown", handlePointer)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open])

  const isRadio = selectedKey !== undefined

  return (
    <div className={styles.menu} ref={rootRef}>
      <button
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>

      {open ? (
        <div className={styles.menuPopover} role="menu" id={menuId} data-align={align}>
          {options.map((option) => {
            const selected = selectedKey === option.key
            return (
              <button
                key={option.key}
                type="button"
                role={isRadio ? "menuitemradio" : "menuitem"}
                aria-checked={isRadio ? selected : undefined}
                className={styles.menuItem}
                data-selected={selected ? "true" : "false"}
                onClick={() => {
                  onSelect(option.key)
                  setOpen(false)
                }}
              >
                {option.icon ? (
                  <span className={styles.menuItemIcon} aria-hidden>
                    {option.icon}
                  </span>
                ) : null}
                <span className={styles.menuItemLabel}>
                  <span>{option.label}</span>
                  {option.hint ? (
                    <span className={styles.menuItemHint}>{option.hint}</span>
                  ) : null}
                </span>
                {isRadio ? <CheckIcon className={styles.menuCheck} /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
