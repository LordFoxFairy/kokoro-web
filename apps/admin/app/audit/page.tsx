"use client";

import { App, Tag } from "antd";
import { PageContainer, ProTable, type ProColumns } from "@ant-design/pro-components";
import { z } from "zod";

import { useAdmin } from "@/components/shell/app-shell";
import { apiGet } from "@/lib/api";

const audit = z.object({ auditRef: z.string(), actionCode: z.string(), occurredAt: z.string() });
type Audit = z.infer<typeof audit>;
const response = z.object({ items: z.array(audit), nextPageToken: z.string().nullable() });

export default function AuditPage(): React.ReactElement {
  const { message } = App.useApp();
  const { siteId } = useAdmin();
  const columns: ProColumns<Audit>[] = [
    { title: "Audit ref", dataIndex: "auditRef", copyable: true, ellipsis: true },
    { title: "动作", dataIndex: "actionCode", render: (_, row) => <Tag>{row.actionCode}</Tag> },
    { title: "发生时间", dataIndex: "occurredAt", valueType: "dateTime", width: 190 },
  ];
  return <PageContainer header={{ title: "审计" }}
    content={siteId ? `当前只查询已授权站点 ${siteId} 的 append-only 审计记录。` : "当前按全局操作员授权查询审计记录。"}>
    <ProTable<Audit> rowKey="auditRef" columns={columns} search={false} pagination={false}
      params={{ siteId }} options={{ reload: true, density: true }} request={async () => { try {
        const path = siteId ? `/api/control/audit?siteId=${encodeURIComponent(siteId)}` : "/api/control/audit";
        const result = await apiGet(path, response);
        return { data: result.items, success: true, total: result.items.length };
      } catch (error) { message.error(error instanceof Error ? error.message : "加载失败");
        return { data: [], success: false, total: 0 }; } }} />
  </PageContainer>;
}
