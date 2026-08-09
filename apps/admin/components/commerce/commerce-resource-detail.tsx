"use client";

import { Alert, Button, Spin } from "antd";
import { PageContainer, ProDescriptions, type ProDescriptionsItemProps } from "@ant-design/pro-components";
import { useOne, type BaseRecord } from "@refinedev/core";

import { useAdmin } from "@/components/shell/app-shell";
import { commerceQueryCanRender } from "@/lib/commerce-query-boundary";

export interface CommerceResourceDetailProps<RecordType extends BaseRecord> {
  readonly resource: string;
  readonly id: string;
  readonly title: string;
  readonly listPath: string;
  readonly readPermission: string;
  readonly columns: readonly ProDescriptionsItemProps<RecordType>[];
}

export function CommerceResourceDetail<RecordType extends BaseRecord>({
  resource,
  id,
  title,
  listPath,
  readPermission,
  columns,
}: CommerceResourceDetailProps<RecordType>): React.ReactElement {
  const { siteId, authorityFingerprint, can } = useAdmin();
  const canRead = can(readPermission);
  const { query, result } = useOne<RecordType>({
    resource,
    id,
    meta: { siteId, authorityFingerprint },
    queryOptions: { enabled: canRead && siteId.length > 0 },
  });
  const canRender = commerceQueryCanRender({ canRead, siteId, error: query.error,
    isFetching: query.isFetching, isPlaceholderData: query.isPlaceholderData });

  return (
    <PageContainer header={{ title }} content={siteId ? `Site：${siteId}` : "请先选择 Site"}
      extra={<Button href={listPath}>返回列表</Button>}>
      {!siteId && <Alert type="warning" showIcon message="请先选择 Site" />}
      {!canRead && <Alert type="error" showIcon message="当前操作员没有此资源的读取权限" />}
      {query.error && <Alert type="error" showIcon message="详情加载失败" description={query.error.message} />}
      <Spin spinning={query.isLoading || query.isFetching}>
        {canRender && result && <ProDescriptions<RecordType> column={2} dataSource={result}
          columns={[...columns]} bordered />}
      </Spin>
    </PageContainer>
  );
}
