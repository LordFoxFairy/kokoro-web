"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Tag } from "antd";
import { PageContainer, ProCard, StatisticCard } from "@ant-design/pro-components";
import {
  UserOutlined,
  WalletOutlined,
  GlobalOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import { z } from "zod";
import { apiGet } from "@/lib/api";
import {
  billingOverviewRequestKey,
  startBillingOverviewRequest,
  type BillingOverview,
  type SettledBillingOverview,
} from "@/lib/billing-overview";
import { useAdmin } from "@/components/shell/app-shell";

const ENTRIES = [
  { label: "用户 360", href: "/users", icon: <UserOutlined />, desc: "查身份 · 积分，并操作" },
  { label: "积分", href: "/credit", icon: <WalletOutlined />, desc: "账户 · 流水 · 定价" },
  { label: "站点", href: "/sites", icon: <GlobalOutlined />, desc: "站点 · 域名 · 策略" },
  { label: "模型", href: "/models", icon: <ApiOutlined />, desc: "目录 · 绑定" },
  { label: "审批", href: "/approvals", icon: <CheckCircleOutlined />, desc: "maker-checker 队列" },
  { label: "审计", href: "/audit", icon: <FileTextOutlined />, desc: "动作留痕" },
  { label: "操作员", href: "/operators", icon: <SafetyOutlined />, desc: "角色 · 作用域" },
];

const pendingSchema = z.array(z.object({ status: z.string() }).passthrough());

// 微单位 → 积分（÷10000）。仅展示用（admin 量级 Number 足够）。
const toCredits = (micros: string): string => (Number(micros) / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function Page(): React.ReactElement {
  const { me, sites, siteId, can } = useAdmin();
  const [pending, setPending] = useState<number | null>(null);
  const [settledBilling, setSettledBilling] = useState<SettledBillingOverview | null>(null);
  const canReadBilling = can("billing.read");
  const billingSiteId = billingOverviewRequestKey({ siteId, canRead: canReadBilling });
  const billing: BillingOverview | null =
    billingSiteId !== null && settledBilling?.siteId === billingSiteId ? settledBilling.data : null;

  useEffect(() => {
    (async () => {
      try {
        const rows = await apiGet("/api/approvals", pendingSchema);
        setPending(rows.filter((r) => r.status === "pending").length);
      } catch {
        setPending(null);
      }
    })();
  }, []);

  useEffect(
    () => startBillingOverviewRequest({ siteId, canRead: canReadBilling }, setSettledBilling),
    [siteId, canReadBilling],
  );

  const scope = me?.scopeSites?.includes("*") ? "全部站点" : `${me?.scopeSites?.length ?? 0} 个站点`;

  return (
    <PageContainer
      header={{ title: "运营概览" }}
      content={
        <span>
          {me?.email ?? "…"}
          {me ? (
            <>
              <Tag color="green">{me.roleKey}</Tag>
              <span style={{ color: "rgba(0,0,0,0.45)" }}>作用域 {scope}</span>
            </>
          ) : null}
        </span>
      }
    >
      <StatisticCard.Group direction="row" style={{ marginBottom: 16 }}>
        <StatisticCard statistic={{ title: "接入站点", value: sites.length, suffix: "个" }} />
        <StatisticCard.Divider />
        <Link href="/approvals" style={{ flex: 1 }}>
          <StatisticCard
            statistic={{
              title: "待审批",
              value: pending ?? "—",
              valueStyle: { color: (pending ?? 0) > 0 ? "#d48806" : undefined },
              description: <span style={{ color: "rgba(0,0,0,0.45)" }}>maker-checker 队列</span>,
            }}
          />
        </Link>
        <StatisticCard.Divider />
        <StatisticCard statistic={{ title: "我的角色", value: me?.roleKey ?? "—" }} />
      </StatisticCard.Group>

      {/* 积分总览：累计发放·消费 / 当前余额 / 账户。模块离线段显 —。 */}
      <ProCard title="积分总览" variant="outlined" headerBordered style={{ marginBottom: 16 }}>
        <StatisticCard.Group direction="row">
          <StatisticCard
            statistic={{ title: "累计发放", value: billing?.credit ? toCredits(billing.credit.grantedTotalMicros) : "—", suffix: "积分" }}
          />
          <StatisticCard.Divider />
          <StatisticCard
            statistic={{ title: "累计消费", value: billing?.credit ? toCredits(billing.credit.spentTotalMicros) : "—", suffix: "积分" }}
          />
          <StatisticCard.Divider />
          <StatisticCard
            statistic={{
              title: "当前余额总额",
              value: billing?.credit ? toCredits(billing.credit.balanceSumMicros) : "—",
              suffix: "积分",
              description: <span style={{ color: "rgba(0,0,0,0.45)" }}>冻结 {billing?.credit ? toCredits(billing.credit.heldSumMicros) : "—"}</span>,
            }}
          />
          <StatisticCard.Divider />
          <StatisticCard
            statistic={{
              title: "积分账户",
              value: billing?.credit ? `${billing.credit.accountsActive}/${billing.credit.accountsTotal}` : "—",
              description: <span style={{ color: "rgba(0,0,0,0.45)" }}>活跃/总</span>,
            }}
          />
        </StatisticCard.Group>
      </ProCard>

      <ProCard title="快捷入口" variant="outlined" headerBordered>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {ENTRIES.map((e) => (
            <Link key={e.href} href={e.href}>
              <ProCard hoverable variant="outlined" size="small" style={{ height: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 20, color: "#2f6b4f" }}>{e.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{e.label}</div>
                    <div style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}>{e.desc}</div>
                  </div>
                </div>
              </ProCard>
            </Link>
          ))}
        </div>
      </ProCard>
    </PageContainer>
  );
}
