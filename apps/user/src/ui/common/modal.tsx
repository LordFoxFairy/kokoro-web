"use client"

// 通用模态浮层:背幕 + 居中卡片,浮在当前工作区之上(语境原地保留,不导航离开)。
// 收口三件可访问性/交互:Esc 关闭、打开期锁 body 滚动、Tab 焦点陷在卡内(不逃到背幕后的工作区)。
// 关闭出口:背幕点击 / Esc / 卡内自带的关闭按钮(由 children 决定)。卡片尺寸档 standard|wide。
// 皮肤守 --k-* token,亮暗双态;窄屏卡片退化为近全屏 sheet(见 modal.module.css)。

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react"

import styles from "./modal.module.css"

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type ModalProps = {
  onClose: () => void
  // 无可视标题时的无障碍名(role=dialog 的 aria-label)。
  ariaLabel: string
  children: ReactNode
  testId?: string
  // 卡片最大宽度档:standard=常规弹窗;wide=双栏面板(设置中心)。
  size?: "standard" | "wide"
}

export function Modal({ onClose, ariaLabel, children, testId, size = "standard" }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  // 打开副作用:Esc 关闭 + 锁背景滚动 + 焦点移入卡内(不留在背后被背幕遮住的元素上)。
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const card = cardRef.current
    const firstFocusable = card?.querySelector<HTMLElement>(FOCUSABLE)
    ;(firstFocusable ?? card)?.focus()
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  // 焦点陷阱:Tab / Shift+Tab 在卡内首尾之间循环,焦点不逃出模态。
  const trapFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab") {
      return
    }
    const card = cardRef.current
    if (card === null) {
      return
    }
    const nodes = card.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (nodes.length === 0) {
      return
    }
    const first = nodes[0]!
    const last = nodes[nodes.length - 1]!
    const active = document.activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={styles.card}
        data-size={size}
        data-testid={testId}
        tabIndex={-1}
        // 卡内点击不冒泡到背幕(背幕 onClick 才关闭)。
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        {children}
      </div>
    </div>
  )
}
