// 页面级单例客户端 + 引擎：整页共享同源 BFF 客户端（鉴权由 httpOnly 信封 cookie 同源携带，
// 前端不持 token），仅浏览器构造，SSR 为 null/惰性。shell 与各域 controller hook 共用这些单例，
// 稳定引用供取数 effect/查询层依赖不抖动。

import { previewClientFromEnv } from "@/dev/preview-transport"
import { createSessionClient, type SessionClient } from "@/engine/client"
import { sessionBaseUrl } from "@/engine/config"
import { createSessionEngine, type SessionEngine } from "@/engine/machine"
import { storedConversationStoreSchema } from "@/core/persistence"
import { createPersistedStore } from "@/lib/persisted-store"

import { createBillingClient, type BillingClient } from "@/billing/client"
import { createPricingClient, type PricingClient } from "@/billing/pricing"
import { createHubClient, type HubClient } from "@/hub/client"
import { createTeamClient, type TeamClient } from "@/team/client"

const STORAGE_KEY = "kokoro.web.conversations"

// 会话清单/成果/分享/模型/agent 读客户端子集（SESS-LIST/MODEL-UX/AGENT-PRESET/SHARE/ARTIFACT-LIB）。
export type ListClient = Pick<
  SessionClient,
  "listSessions" | "listModels" | "listAgents" | "listArtifacts" | "createShare" | "revokeShare" | "renameSession"
>

let pageHubClient: HubClient | null = null
export function browserHubClient(): HubClient {
  if (!pageHubClient) {
    pageHubClient = createHubClient()
  }
  return pageHubClient
}

let pageBillingClient: BillingClient | null = null
export function browserBillingClient(): BillingClient {
  if (!pageBillingClient) {
    pageBillingClient = createBillingClient()
  }
  return pageBillingClient
}

let pagePricingClient: PricingClient | null = null
export function browserPricingClient(): PricingClient {
  if (!pagePricingClient) {
    pagePricingClient = createPricingClient()
  }
  return pagePricingClient
}

let pageTeamClient: TeamClient | null = null
export function browserTeamClient(): TeamClient {
  if (!pageTeamClient) {
    pageTeamClient = createTeamClient()
  }
  return pageTeamClient
}

// 会话清单读客户端：与引擎同源选择（preview 假流优先，否则 `/api/session` BFF）。listModels/
// listAgents 复用同客户端。
let pageListClient: ListClient | null = null
export function browserListClient(): ListClient {
  if (!pageListClient) {
    pageListClient = previewClientFromEnv() ?? createSessionClient({ baseUrl: sessionBaseUrl() })
  }
  return pageListClient
}

// 整页共享一个引擎实例（含流句柄与重连计时器），仅浏览器创建，SSR 为 null。
let pageEngine: SessionEngine | null = null
export function browserEngine(): SessionEngine | null {
  if (typeof window === "undefined") {
    return null
  }
  if (!pageEngine) {
    // 显式 env 开关的开发假流优先；否则走同源 `/api/session` BFF 代理。
    const client = previewClientFromEnv() ?? createSessionClient({ baseUrl: sessionBaseUrl() })
    pageEngine = createSessionEngine({
      client,
      storage: createPersistedStore({
        key: STORAGE_KEY,
        schema: storedConversationStoreSchema,
      }),
    })
  }
  return pageEngine
}
