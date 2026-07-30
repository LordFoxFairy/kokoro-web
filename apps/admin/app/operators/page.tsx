"use client";

import { App, Tag } from "antd";
import { PageContainer, ProTable, type ProColumns } from "@ant-design/pro-components";
import { z } from "zod";
import { apiGet } from "@/lib/api";

const operator = z.object({ operatorRef: z.string(), operatorGeneration: z.string(), state: z.string(),
  effectivePermissions: z.array(z.string()), effectiveSiteScopes: z.array(z.object({ siteId: z.string() })),
  expiresAt: z.string() });
type Operator = z.infer<typeof operator>;
const response = z.object({ items: z.array(operator), nextPageToken: z.string().nullable() });

export default function OperatorsPage(): React.ReactElement {
  const { message } = App.useApp();
  const columns: ProColumns<Operator>[] = [
    { title: "操作员", dataIndex: "operatorRef", copyable: true, ellipsis: true },
    { title: "代次", dataIndex: "operatorGeneration", width: 80 },
    { title: "状态", dataIndex: "state", width: 100,
      render: (_, row) => <Tag color={row.state === "active" ? "green" : "red"}>{row.state}</Tag> },
    { title: "站点作用域", render: (_, row) => row.effectiveSiteScopes.map((item) => item.siteId).join(" · ") || "—" },
    { title: "有效权限", render: (_, row) => `${row.effectivePermissions.length} 项`, width: 110 },
    { title: "到期", dataIndex: "expiresAt", valueType: "dateTime", width: 180 },
  ];
  return <PageContainer header={{ title: "操作员" }} content="Platform 实时计算的操作员状态、权限与站点作用域。">
    <ProTable<Operator> rowKey="operatorRef" columns={columns} search={false} pagination={false}
      options={{ reload: true, density: true }} request={async () => { try { const result = await apiGet("/api/control/operators", response); return { data: result.items, success: true, total: result.items.length }; } catch (error) { message.error(error instanceof Error ? error.message : "加载失败"); return { data: [], success: false, total: 0 }; } }} />
  </PageContainer>;
}
