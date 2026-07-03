// session base URL 唯一读取点：只认显式 env，缺失即 fail-loud（无端口嗅探、无 demo 兜底）。
export function sessionBaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SESSION_BASE_URL
  if (!value) {
    throw new Error("NEXT_PUBLIC_SESSION_BASE_URL is not set")
  }
  return value
}
