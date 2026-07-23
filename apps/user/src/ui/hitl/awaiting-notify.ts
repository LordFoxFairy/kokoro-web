// 待批系统通知（HITL-NOTIFY，可选增强）：新待批出现时请求授权并弹桌面通知；
// 不支持 / 权限被拒 / 被策略拦截一律静默——通知是锦上添花，绝不阻断主流程或报错。

export function notifyAwaiting(title: string, body: string): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return
  }
  try {
    if (Notification.permission === "granted") {
      new Notification(title, { body })
    } else if (Notification.permission === "default") {
      void Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          new Notification(title, { body })
        }
      })
    }
    // denied：静默，不再打扰。
  } catch {
    // 某些环境（无 HTTPS / 被 iframe 策略拦截）会抛：静默吞掉。
  }
}
