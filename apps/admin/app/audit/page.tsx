"use client";

import { useMemo } from "react";
import { Alert, Button, Tag } from "antd";
import { PageContainer, ProTable, type ProColumns } from "@ant-design/pro-components";
import { DownOutlined } from "@ant-design/icons";
import { useInfiniteList } from "@refinedev/core";

import { useAdmin } from "@/components/shell/app-shell";
import {
  adminInfiniteResult,
  adminNextPageParam,
  type AdminAudit,
} from "@/lib/refine/admin-data-provider";

export default function AuditPage(): React.ReactElement {
  const { siteId } = useAdmin();
  const filters = useMemo(() => siteId
    ? [{ field: "siteId", operator: "eq" as const, value: siteId }]
    : [], [siteId]);
  const { query } = useInfiniteList<AdminAudit>({
    resource: "audit",
    pagination: { mode: "server", currentPage: 1, pageSize: 100 },
    filters,
    queryOptions: { getNextPageParam: adminNextPageParam },
  });
  const list = adminInfiniteResult(query.data);
  const listError = query.error ?? list.error;
  const columns: ProColumns<AdminAudit>[] = [
    { title: "Audit ref", dataIndex: "auditRef", copyable: true, ellipsis: true },
    { title: "动作", dataIndex: "actionCode", render: (_, row) => <Tag>{row.actionCode}</Tag> },
    { title: "发生时间", dataIndex: "occurredAt", valueType: "dateTime", width: 190 },
  ];
  return <PageContainer header={{ title: "审计" }}
    content={siteId ? `当前只查询已授权站点 ${siteId} 的 append-only 审计记录。` : "当前按全局操作员授权查询审计记录。"}>
    {listError && <Alert type="error" showIcon message="审计列表加载失败"
      description={listError.message} style={{ marginBottom: 16 }} />}
    <ProTable<AdminAudit> rowKey="auditRef" columns={columns} search={false} pagination={false}
      dataSource={list.records} loading={query.isLoading || (query.isFetching && !query.isFetchingNextPage)}
      options={{ reload: () => { void query.refetch(); }, density: true }}
      toolBarRender={() => query.hasNextPage ? [<Button key="load-more" icon={<DownOutlined />}
        loading={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>加载更多</Button>] : []} />
  </PageContainer>;
}
