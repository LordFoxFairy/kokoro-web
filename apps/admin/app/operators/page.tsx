"use client";

import { Alert, Button, Tag } from "antd";
import { PageContainer, ProTable, type ProColumns } from "@ant-design/pro-components";
import { DownOutlined } from "@ant-design/icons";
import { useInfiniteList } from "@refinedev/core";

import {
  adminInfiniteResult,
  adminNextPageParam,
  type AdminOperator,
} from "@/lib/refine/admin-data-provider";

export default function OperatorsPage(): React.ReactElement {
  const { query } = useInfiniteList<AdminOperator>({
    resource: "operators",
    pagination: { mode: "server", currentPage: 1, pageSize: 100 },
    queryOptions: { getNextPageParam: adminNextPageParam },
  });
  const list = adminInfiniteResult(query.data);
  const listError = query.error ?? list.error;
  const columns: ProColumns<AdminOperator>[] = [
    { title: "操作员", dataIndex: "operatorRef", copyable: true, ellipsis: true },
    { title: "代次", dataIndex: "operatorGeneration", width: 80 },
    { title: "状态", dataIndex: "state", width: 100,
      render: (_, row) => <Tag color={row.state === "active" ? "green" : "red"}>{row.state}</Tag> },
    { title: "站点作用域", render: (_, row) => row.effectiveSiteScopes.map((item) => item.siteId).join(" · ") || "—" },
    { title: "有效权限", render: (_, row) => `${row.effectivePermissions.length} 项`, width: 110 },
    { title: "到期", dataIndex: "expiresAt", valueType: "dateTime", width: 180 },
  ];
  return <PageContainer header={{ title: "操作员" }} content="Platform 实时计算的操作员状态、权限与站点作用域。">
    {listError && <Alert type="error" showIcon message="操作员列表加载失败"
      description={listError.message} style={{ marginBottom: 16 }} />}
    <ProTable<AdminOperator> rowKey="operatorRef" columns={columns} search={false} pagination={false}
      dataSource={list.records} loading={query.isLoading || (query.isFetching && !query.isFetchingNextPage)}
      options={{ reload: () => { void query.refetch(); }, density: true }}
      toolBarRender={() => query.hasNextPage ? [<Button key="load-more" icon={<DownOutlined />}
        loading={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>加载更多</Button>] : []} />
  </PageContainer>;
}
