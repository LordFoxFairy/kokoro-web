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
  type AdminApproval,
} from "@/lib/refine/admin-data-provider";

export default function ApprovalsPage(): React.ReactElement {
  const { siteId } = useAdmin();
  const filters = useMemo(() => siteId
    ? [{ field: "siteId", operator: "eq" as const, value: siteId }]
    : [], [siteId]);
  const { query } = useInfiniteList<AdminApproval>({
    resource: "approvals",
    pagination: { mode: "server", currentPage: 1, pageSize: 100 },
    filters,
    queryOptions: { getNextPageParam: adminNextPageParam },
  });
  const list = adminInfiniteResult(query.data);
  const listError = query.error ?? list.error;
  const columns: ProColumns<AdminApproval>[] = [
    { title: "操作", dataIndex: "operation", render: (_, row) => <Tag color="gold">{row.operation}</Tag> },
    { title: "站点", dataIndex: "targetSiteRef", render: (_, row) => row.targetSiteRef ?? "全局" },
    { title: "申请人", dataIndex: "makerRef", copyable: true },
    { title: "理由", dataIndex: "operatorReason", ellipsis: true },
    { title: "申请时间", dataIndex: "admittedAt", valueType: "dateTime", width: 180 },
    { title: "到期", dataIndex: "expiresAt", valueType: "dateTime", width: 180 },
  ];
  return <PageContainer header={{ title: "待审批" }} content="只展示当前权限范围内仍有效的 maker-checker 请求。具体批准在对应资源页完成。">
    {listError && <Alert type="error" showIcon message="审批列表加载失败"
      description={listError.message} style={{ marginBottom: 16 }} />}
    <ProTable<AdminApproval> rowKey="id" columns={columns} search={false} pagination={false}
      dataSource={list.records} loading={query.isLoading || (query.isFetching && !query.isFetchingNextPage)}
      options={{ reload: () => { void query.refetch(); }, density: true }}
      toolBarRender={() => query.hasNextPage ? [<Button key="load-more" icon={<DownOutlined />}
        loading={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>加载更多</Button>] : []} />
  </PageContainer>;
}
