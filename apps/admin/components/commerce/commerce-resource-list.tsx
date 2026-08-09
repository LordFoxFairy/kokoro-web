"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Alert, Button } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { PageContainer, ProTable, type ProColumns } from "@ant-design/pro-components";
import { useInfiniteList, type BaseRecord } from "@refinedev/core";

import { useAdmin } from "@/components/shell/app-shell";
import { commerceQueryCanRender } from "@/lib/commerce-query-boundary";
import { adminInfiniteResult, adminNextPageParam } from "@/lib/refine/admin-data-provider";

export interface CommerceResourceListProps<RecordType extends BaseRecord> {
  readonly resource: string;
  readonly title: string;
  readonly description: string;
  readonly detailBase: string;
  readonly readPermission: string;
  readonly columns: readonly ProColumns<RecordType>[];
  readonly extra?: React.ReactNode;
}

export function CommerceResourceList<RecordType extends BaseRecord>({
  resource,
  title,
  description,
  detailBase,
  readPermission,
  columns,
  extra,
}: CommerceResourceListProps<RecordType>): React.ReactElement {
  const { siteId, authorityFingerprint, can } = useAdmin();
  const canRead = can(readPermission);
  const filters = useMemo(() => siteId
    ? [{ field: "siteId", operator: "eq" as const, value: siteId }]
    : [], [siteId]);
  const { query } = useInfiniteList<RecordType>({
    resource,
    pagination: { mode: "server", currentPage: 1, pageSize: 100 },
    filters,
    meta: { authorityFingerprint },
    queryOptions: { enabled: canRead && siteId.length > 0, getNextPageParam: adminNextPageParam },
  });
  const list = adminInfiniteResult(query.data);
  const listError = query.error ?? list.error;
  const canRender = commerceQueryCanRender({ canRead, siteId, error: listError,
    isFetching: query.isFetching, isFetchingNextPage: query.isFetchingNextPage,
    isPlaceholderData: query.isPlaceholderData });
  const visibleRecords = canRender ? list.records : [];
  const tableColumns: ProColumns<RecordType>[] = [
    ...columns,
    { title: "操作", valueType: "option", width: 84, render: (_, row) => (
      <Link href={`${detailBase}/${encodeURIComponent(String(row.id))}`}>详情</Link>
    ) },
  ];

  return (
    <PageContainer header={{ title }} content={`${description}${siteId ? ` 当前 Site：${siteId}` : ""}`} extra={extra}>
      {!siteId && <Alert type="warning" showIcon message="请先选择 Site" style={{ marginBottom: 16 }} />}
      {!canRead && <Alert type="error" showIcon message="当前操作员没有此资源的读取权限"
        style={{ marginBottom: 16 }} />}
      {listError && <Alert type="error" showIcon message="资源加载失败" description={listError.message}
        style={{ marginBottom: 16 }} />}
      <ProTable<RecordType>
        rowKey="id"
        columns={tableColumns}
        search={false}
        pagination={false}
        dataSource={visibleRecords}
        loading={query.isLoading || (query.isFetching && !query.isFetchingNextPage)}
        options={{ reload: () => { void query.refetch(); }, density: true }}
        toolBarRender={() => query.hasNextPage ? [
          <Button key="load-more" icon={<DownOutlined />} loading={query.isFetchingNextPage}
            onClick={() => { void query.fetchNextPage(); }}>加载更多</Button>,
        ] : []}
      />
    </PageContainer>
  );
}
