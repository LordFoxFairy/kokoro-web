// Admin Web owns a closed navigation dictionary. Domain forms carry their own
// explicit labels; retired manifest/resource surfaces must not grow this file.

export type Locale = "zh" | "en";
export const LOCALES: readonly Locale[] = ["zh", "en"];
export const DEFAULT_LOCALE: Locale = "zh";
export const LOCALE_STORAGE_KEY = "kokoro.admin.locale";

export const zh = {
  "nav.overview": "概览",
  "nav.group.business": "业务",
  "nav.group.commerce": "商品与卡密",
  "nav.group.ops": "运营",
  "nav.users": "用户",
  "nav.credit": "积分",
  "nav.sites": "站点",
  "nav.models": "模型",
  "nav.creditPrograms": "Credit Programs",
  "nav.entitlementTemplates": "权益模板",
  "nav.offers": "Offers",
  "nav.redemptionPrograms": "兑换规则",
  "nav.codeBatches": "卡密批次",
  "nav.approvals": "审批",
  "nav.audit": "审计",
  "nav.operators": "操作员",
  "ui.logout": "退出登录",
  "ui.language": "语言",
  "ui.selectSite": "选择站点",
  "ui.noSite": "无站点",
} as const;

export type MessageKey = keyof typeof zh;
