"use client";

import { App, Tag } from "antd";
import { PageContainer, ProTable, type ProColumns } from "@ant-design/pro-components";
import { z } from "zod";
import { apiGet } from "@/lib/api";
import { useAdmin } from "@/components/shell/app-shell";

const approval = z.object({ approvalRef: z.string(), operation: z.string(), makerRef: z.string(),
  targetSiteRef: z.string().nullable(), environment: z.string(), region: z.string(), operatorReason: z.string(),
  admittedAt: z.string(), expiresAt: z.string() });
type Approval = z.infer<typeof approval>;
const response = z.object({ items: z.array(approval), nextPageToken: z.string().nullable() });

export default function ApprovalsPage(): React.ReactElement {
  const { message } = App.useApp(); const { siteId } = useAdmin();
  const columns: ProColumns<Approval>[] = [
    { title: "操作", dataIndex: "operation", render: (_, row) => <Tag color="gold">{row.operation}</Tag> },
    { title: "站点", dataIndex: "targetSiteRef", render: (_, row) => row.targetSiteRef ?? "全局" },
    { title: "申请人", dataIndex: "makerRef", copyable: true },
    { title: "理由", dataIndex: "operatorReason", ellipsis: true },
    { title: "申请时间", dataIndex: "admittedAt", valueType: "dateTime", width: 180 },
    { title: "到期", dataIndex: "expiresAt", valueType: "dateTime", width: 180 },
  ];
  return <PageContainer header={{ title: "待审批" }} content="只展示当前权限范围内仍有效的 maker-checker 请求。具体批准在对应资源页完成。">
    <ProTable<Approval> rowKey="approvalRef" columns={columns} search={false} pagination={false}
      params={{ siteId }} options={{ reload: true, density: true }} request={async () => { try { const query = siteId ? `?siteId=${encodeURIComponent(siteId)}` : ""; const result = await apiGet(`/api/control/approvals${query}`, response); return { data: result.items, success: true, total: result.items.length }; } catch (error) { message.error(error instanceof Error ? error.message : "加载失败"); return { data: [], success: false, total: 0 }; } }} />
  </PageContainer>;
}
