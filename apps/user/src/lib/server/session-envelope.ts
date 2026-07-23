// BFF 会话信封（服务端专用）：把 kokoro-user 签发结果密封进 httpOnly cookie，浏览器 JS
// 读不到、改不动。AES-256-GCM 认证加密（node:crypto，无外部依赖）：随机 12 字节 IV/次，
// GCM 认证标签防篡改；密钥从 secret 经 SHA-256 派生 32 字节。双钥轮换：secrets[0] 封，读时
// 依次尝试全部（轮换窗口内旧信封仍可解）。exp 同时封进载荷并在解封时强校验。

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { z } from "zod"

// 信封载荷：session 代理注入 Bearer 用 runtime_jwt；其余字段供 hub/UI 读 namespace/site 身份轴。
export const envelopePayloadSchema = z
  .object({
    runtime_jwt: z.string().min(1),
    // runtime_jwt 的 exp（epoch 秒）：代理据此判断 access 是否快过期、该不该静默续期。
    access_exp: z.number().int().positive(),
    // 长效 refresh 明文：代理在 access 快过期时用它调 user /auth/refresh 换新 access。
    // 只在服务端信封内（AES 加密 + httpOnly），浏览器 JS 读不到。
    refresh_token: z.string().min(1),
    user_id: z.string().min(1),
    namespace: z.string().min(1),
    site_id: z.string().min(1),
    // 信封/cookie 生命周期 = refresh 的 exp（epoch 秒，通常 30 天）：解封强校验，cookie Max-Age 亦据此。
    // 注意语义：这是信封整体寿命（跟随 refresh），不是 access 寿命（access 用 access_exp）。
    exp: z.number().int().positive(),
  })
  .strict()

export type EnvelopePayload = z.infer<typeof envelopePayloadSchema>

function deriveKey(secret: string): Buffer {
  // 任意 secret → 定长 32 字节 A256 密钥（GCM 要求）。
  return createHash("sha256").update(secret, "utf8").digest()
}

function firstSecret(secrets: string[]): string {
  const current = secrets[0]
  if (current === undefined || current.length === 0) {
    throw new Error("session envelope requires at least one signing secret")
  }
  return current
}

// 密封：current 密钥 + 一次性随机 IV。三段 base64url：iv.ciphertext.tag。
export function sealEnvelope(payload: EnvelopePayload, secrets: string[]): string {
  const key = deriveKey(firstSecret(secrets))
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8")
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".")
}

// 解封：结构不符/篡改/过期/全钥失败 → null（调用方按未认证处理，不区分原因）。
export function openEnvelope(
  token: string,
  secrets: string[],
  nowEpochSec: number,
): EnvelopePayload | null {
  const parts = token.split(".")
  if (parts.length !== 3) {
    return null
  }
  let iv: Buffer
  let ciphertext: Buffer
  let tag: Buffer
  try {
    iv = Buffer.from(parts[0]!, "base64url")
    ciphertext = Buffer.from(parts[1]!, "base64url")
    tag = Buffer.from(parts[2]!, "base64url")
  } catch {
    return null
  }
  if (iv.length !== 12 || tag.length !== 16) {
    return null
  }
  for (const secret of secrets) {
    if (secret.length === 0) {
      continue
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv)
      decipher.setAuthTag(tag)
      // final() 在认证标签不匹配时抛错——错钥/篡改都走到这里，静默尝试下一把。
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      const parsed = envelopePayloadSchema.safeParse(JSON.parse(plaintext.toString("utf8")))
      if (!parsed.success) {
        return null
      }
      if (parsed.data.exp <= nowEpochSec) {
        return null
      }
      return parsed.data
    } catch {
      // 这把密钥解不开：轮换窗口内换下一把。
    }
  }
  return null
}

// 常量时间比对（nonce 校验等场景复用）：长度不同直接 false，不泄漏比对进度。
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) {
    return false
  }
  return timingSafeEqual(bufA, bufB)
}
