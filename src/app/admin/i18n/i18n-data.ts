import type { I18nEntry, I18nWorkbenchPayload } from "./i18n-workbench"

const supportedLocales = ["zh-CN", "en-US"] as const

const zhCNMessages = {
  "platform.modules.site": "站点",
  "platform.modules.user": "用户",
  "platform.modules.model": "模型",
  "platform.modules.credit": "积分",
  "platform.modules.payment": "支付",
  "platform.modules.litellm": "LiteLLM 网关",
  "admin.modules.site": "站点管理",
  "admin.site.resources.sites": "站点",
  "admin.site.resources.domains": "域名",
  "admin.site.resources.apps": "应用",
  "admin.site.resources.policies": "策略",
  "admin.site.actions.upsert": "保存站点",
  "admin.site.actions.bindDomain": "绑定域名",
  "admin.site.actions.configureApp": "配置应用",
  "admin.site.actions.setPolicy": "设置策略",
  "admin.modules.user": "用户管理",
  "admin.user.resources.users": "用户",
  "admin.user.resources.teams": "团队",
  "admin.user.resources.memberships": "成员关系",
  "admin.user.resources.serviceAccounts": "服务账号",
  "admin.user.actions.disable": "禁用用户",
  "admin.user.actions.changeRole": "调整角色",
  "admin.user.actions.revokeServiceAccount": "撤销服务账号",
  "admin.modules.model": "模型管理",
  "admin.model.resources.providerAccounts": "Provider 账号",
  "admin.model.resources.modelBindings": "模型绑定",
  "admin.model.resources.modelLabels": "模型标签",
  "admin.model.actions.disableProviderAccount": "禁用 Provider 账号",
  "admin.model.actions.publishBinding": "发布绑定",
  "admin.modules.credit": "积分管理",
  "admin.credit.resources.accounts": "积分账户",
  "admin.credit.resources.ledgerEntries": "账本流水",
  "admin.credit.resources.usageRecords": "用量记录",
  "admin.credit.resources.pricingRules": "计价规则",
  "admin.credit.actions.grant": "发放积分",
  "admin.modules.payment": "支付管理",
  "admin.payment.resources.plans": "套餐",
  "admin.payment.resources.orders": "订单",
  "admin.payment.resources.subscriptions": "订阅",
  "admin.payment.resources.paymentEvents": "支付事件",
  "admin.payment.resources.refunds": "退款",
  "admin.payment.actions.publishPlan": "发布套餐",
  "admin.payment.actions.approveRefund": "批准退款",
} as const

const enUSMessages: Record<keyof typeof zhCNMessages, string> = {
  "platform.modules.site": "Site",
  "platform.modules.user": "User",
  "platform.modules.model": "Model",
  "platform.modules.credit": "Credit",
  "platform.modules.payment": "Payment",
  "platform.modules.litellm": "LiteLLM Gateway",
  "admin.modules.site": "Site Admin",
  "admin.site.resources.sites": "Sites",
  "admin.site.resources.domains": "Domains",
  "admin.site.resources.apps": "Apps",
  "admin.site.resources.policies": "Policies",
  "admin.site.actions.upsert": "Save Site",
  "admin.site.actions.bindDomain": "Bind Domain",
  "admin.site.actions.configureApp": "Configure App",
  "admin.site.actions.setPolicy": "Set Policy",
  "admin.modules.user": "User Admin",
  "admin.user.resources.users": "Users",
  "admin.user.resources.teams": "Teams",
  "admin.user.resources.memberships": "Memberships",
  "admin.user.resources.serviceAccounts": "Service Accounts",
  "admin.user.actions.disable": "Disable User",
  "admin.user.actions.changeRole": "Change Role",
  "admin.user.actions.revokeServiceAccount": "Revoke Service Account",
  "admin.modules.model": "Model Admin",
  "admin.model.resources.providerAccounts": "Provider Accounts",
  "admin.model.resources.modelBindings": "Model Bindings",
  "admin.model.resources.modelLabels": "Model Labels",
  "admin.model.actions.disableProviderAccount": "Disable Provider Account",
  "admin.model.actions.publishBinding": "Publish Binding",
  "admin.modules.credit": "Credit Admin",
  "admin.credit.resources.accounts": "Credit Accounts",
  "admin.credit.resources.ledgerEntries": "Ledger Entries",
  "admin.credit.resources.usageRecords": "Usage Records",
  "admin.credit.resources.pricingRules": "Pricing Rules",
  "admin.credit.actions.grant": "Grant Credits",
  "admin.modules.payment": "Payment Admin",
  "admin.payment.resources.plans": "Plans",
  "admin.payment.resources.orders": "Orders",
  "admin.payment.resources.subscriptions": "Subscriptions",
  "admin.payment.resources.paymentEvents": "Payment Events",
  "admin.payment.resources.refunds": "Refunds",
  "admin.payment.actions.publishPlan": "Publish Plan",
  "admin.payment.actions.approveRefund": "Approve Refund",
}

const catalogKeys = Object.keys(zhCNMessages) as Array<keyof typeof zhCNMessages>

export function createI18nWorkbenchPayload(locale: string): I18nWorkbenchPayload {
  const normalizedLocale = normalizeI18nLocale(locale)
  const duplicateSourceTexts = findDuplicateSourceTexts()
  const entries = catalogKeys.map((key) => {
    const sourceText = zhCNMessages[key]

    return {
      key,
      sourceText,
      context: contextForKey(key),
      zhCN: sourceText,
      enUS: enUSMessages[key],
      status: duplicateSourceTexts.has(sourceText) ? "ambiguous" : "ready",
      source: sourceForKey(key),
    } satisfies I18nEntry
  })

  return {
    locale: normalizedLocale,
    locales: supportedLocales,
    entries,
    filters: {
      contexts: unique(entries.map((entry) => entry.context).filter((context) => context !== undefined)),
      sources: unique(entries.map((entry) => entry.source)),
    },
    summary: {
      total: entries.length,
      ready: entries.filter((entry) => entry.status === "ready").length,
      ambiguous: entries.filter((entry) => entry.status === "ambiguous").length,
    },
  }
}

function normalizeI18nLocale(locale: string): (typeof supportedLocales)[number] {
  return supportedLocales.includes(locale as (typeof supportedLocales)[number])
    ? (locale as (typeof supportedLocales)[number])
    : "zh-CN"
}

function findDuplicateSourceTexts(): ReadonlySet<string> {
  const counts = new Map<string, number>()

  for (const message of Object.values(zhCNMessages)) {
    counts.set(message, (counts.get(message) ?? 0) + 1)
  }

  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([message]) => message))
}

function contextForKey(key: string): string | undefined {
  if (key.startsWith("platform.modules.")) {
    return "platform.module"
  }

  if (key.startsWith("admin.modules.")) {
    return "admin.module"
  }

  if (key.includes(".resources.")) {
    return "admin.resource"
  }

  if (key.includes(".actions.")) {
    return "admin.action"
  }

  return undefined
}

function sourceForKey(key: string): string {
  if (key.startsWith("platform.")) {
    return "platform"
  }

  const parts = key.split(".")
  return parts[1] === "modules" ? (parts[2] ?? "platform") : (parts[1] ?? "platform")
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}
