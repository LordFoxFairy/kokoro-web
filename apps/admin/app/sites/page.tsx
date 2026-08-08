"use client";

import { useState } from "react";
import { Alert, App, Button, Descriptions, Modal, Space, Spin, Tag } from "antd";
import { ModalForm, PageContainer, ProFormText, ProFormTextArea, ProTable,
  type ProColumns } from "@ant-design/pro-components";
import { DownOutlined } from "@ant-design/icons";
import { useInfiniteList, useOne } from "@refinedev/core";
import { z } from "zod";

import { useAdmin } from "@/components/shell/app-shell";
import { apiPost } from "@/lib/api";
import {
  adminInfiniteResult,
  adminNextPageParam,
  type AdminSite,
} from "@/lib/refine/admin-data-provider";

const receipt = z.object({ commandId: z.string(), state: z.string() });
const registered = z.object({ siteId: z.string(), state: z.string(), replayed: z.boolean(), receipt });
const published = z.object({ siteId: z.string(), releaseRef: z.string(), releaseRevision: z.string(),
  releaseDigest: z.string(), state: z.string(), replayed: z.boolean(), receipt });

export default function SitesPage(): React.ReactElement {
  const { siteId, reloadSites } = useAdmin();
  const [detailSiteRef, setDetailSiteRef] = useState<string | null>(null);
  const { query: listQuery } = useInfiniteList<AdminSite>({
    resource: "sites",
    pagination: { mode: "server", currentPage: 1, pageSize: 100 },
    queryOptions: { getNextPageParam: adminNextPageParam },
  });
  const { query: detailQuery, result: detail } = useOne<AdminSite>({
    resource: "sites",
    id: detailSiteRef ?? "",
    queryOptions: { enabled: detailSiteRef !== null },
  });
  const list = adminInfiniteResult(listQuery.data);
  const listError = listQuery.error ?? list.error;
  const columns: ProColumns<AdminSite>[] = [
    { title: "Site", dataIndex: "siteRef", copyable: true, ellipsis: true },
    { title: "状态", dataIndex: "status", render: (_, row) => <Tag color="blue">{row.status}</Tag> },
    { title: "安全代次", dataIndex: "securityEpoch", width: 120 },
    { title: "操作", valueType: "option", render: (_, row) =>
      <Button type="link" onClick={() => setDetailSiteRef(row.siteRef)}>详情</Button> },
  ];

  return <PageContainer header={{ title: "站点与发布" }}
    content="中央 Admin 通过 Platform typed control plane 管理独立 Site。站点注册使用全局授权；发布只使用当前选中的 Site 授权。"
    extra={<Space wrap>
      <Button href="/api/control/auth/step-up?operation=site.register&resource=platform-sites&return=/sites">提升注册认证</Button>
      <RegisterSite onRegistered={() => { reloadSites(); void listQuery.refetch(); }} />
      <Button disabled={!siteId}
        href={siteId ? `/api/control/auth/step-up?operation=site.release.publish&resource=${encodeURIComponent(siteId)}&return=/sites` : undefined}>
        提升发布认证
      </Button>
      <PublishRelease siteId={siteId} onPublished={() => { void listQuery.refetch(); }} />
    </Space>}>
    {listError && <Alert type="error" showIcon message="站点列表加载失败"
      description={listError.message} style={{ marginBottom: 16 }} />}
    <ProTable<AdminSite> rowKey="siteRef" columns={columns} search={false} pagination={false}
      dataSource={list.records}
      loading={listQuery.isLoading || (listQuery.isFetching && !listQuery.isFetchingNextPage)}
      options={{ reload: () => { void listQuery.refetch(); }, density: true }}
      toolBarRender={() => listQuery.hasNextPage ? [<Button key="load-more" icon={<DownOutlined />}
        loading={listQuery.isFetchingNextPage}
        onClick={() => { void listQuery.fetchNextPage(); }}>加载更多</Button>] : []} />
    <Modal title="站点详情" open={detailSiteRef !== null} footer={null}
      onCancel={() => setDetailSiteRef(null)} destroyOnHidden>
      <Spin spinning={detailQuery.isLoading || detailQuery.isFetching}>
        {detailQuery.error && <Alert type="error" showIcon message="站点详情加载失败"
          description={detailQuery.error.message} />}
        {detail && <Descriptions column={1} items={[
          { key: "site", label: "Site", children: detail.siteRef },
          { key: "status", label: "状态", children: detail.status },
          { key: "epoch", label: "安全代次", children: detail.securityEpoch },
        ]} />}
      </Spin>
    </Modal>
  </PageContainer>;
}

function RegisterSite({ onRegistered }: Readonly<{ onRegistered: () => void }>): React.ReactElement {
  const { message } = App.useApp();
  return <ModalForm title="注册站点" trigger={<Button type="primary">注册站点</Button>} width={680}
    modalProps={{ destroyOnHidden: true }} onFinish={async (values) => { try {
      await apiPost("/api/control/sites", {
        siteId: String(values.siteId), siteKey: String(values.siteKey),
        projectBindingRef: String(values.projectBindingRef), repositoryRef: String(values.repositoryRef),
        providerNamespace: String(values.providerNamespace), providerProjectRef: String(values.providerProjectRef),
        workloadIdentityRef: String(values.workloadIdentityRef),
      }, registered);
      message.success("站点已进入 preview_ready"); onRegistered(); return true;
    } catch (error) { message.error(error instanceof Error ? error.message : "注册失败"); return false; } }}>
    <ProFormText name="siteId" label="Site ID" rules={[{ required: true }]} />
    <ProFormText name="siteKey" label="Site key" rules={[{ required: true }]} />
    <ProFormText name="projectBindingRef" label="Project binding ref" rules={[{ required: true }]} />
    <ProFormText name="repositoryRef" label="Web repository ref" rules={[{ required: true }]} />
    <ProFormText name="providerNamespace" label="Provider namespace" rules={[{ required: true }]} />
    <ProFormText name="providerProjectRef" label="Provider project ref" rules={[{ required: true }]} />
    <ProFormText name="workloadIdentityRef" label="Workload identity ref" placeholder="spiffe://…"
      rules={[{ required: true }]} />
  </ModalForm>;
}

function PublishRelease({ siteId, onPublished }: Readonly<{
  siteId: string; onPublished: () => void;
}>): React.ReactElement {
  const { message } = App.useApp();
  return <ModalForm title="发布已认证 SiteRelease" trigger={<Button type="primary" disabled={!siteId}>发布 release</Button>}
    width={760} modalProps={{ destroyOnHidden: true }} onFinish={async (values) => { try {
      await apiPost("/api/control/sites/releases", {
        siteId, candidateRef: String(values.candidateRef), candidateVersion: String(values.candidateVersion),
        candidateAuthorizationEpoch: String(values.candidateAuthorizationEpoch),
        candidateDigest: String(values.candidateDigest), reason: String(values.reason),
      }, published);
      message.success("SiteRelease 已发布"); onPublished(); return true;
    } catch (error) { message.error(error instanceof Error ? error.message : "发布失败"); return false; } }}>
    <ProFormText name="candidateRef" label="Authorized candidate ref" rules={[{ required: true }]} />
    <ProFormText name="candidateVersion" label="Candidate version" rules={[{ required: true }]} />
    <ProFormText name="candidateAuthorizationEpoch" label="Candidate authorization epoch"
      rules={[{ required: true }]} />
    <ProFormText name="candidateDigest" label="Candidate digest（sha256:…）" rules={[{ required: true }]} />
    <ProFormTextArea name="reason" label="发布原因" fieldProps={{ rows: 4 }} rules={[{ required: true }]} />
  </ModalForm>;
}
