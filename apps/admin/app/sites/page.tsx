"use client";

import { useRef, useState } from "react";
import { App, Button, Descriptions, Modal, Space, Tag } from "antd";
import { ModalForm, PageContainer, ProFormText, ProFormTextArea, ProTable,
  type ActionType, type ProColumns } from "@ant-design/pro-components";
import { z } from "zod";

import { useAdmin } from "@/components/shell/app-shell";
import { apiGet, apiPost } from "@/lib/api";

const site = z.object({ siteRef: z.string(), status: z.string(), securityEpoch: z.string() });
type Site = z.infer<typeof site>;
const siteList = z.object({ items: z.array(site), nextPageToken: z.string().nullable() });
const receipt = z.object({ commandId: z.string(), state: z.string() });
const registered = z.object({ siteId: z.string(), state: z.string(), replayed: z.boolean(), receipt });
const published = z.object({ siteId: z.string(), releaseRef: z.string(), state: z.string(),
  replayed: z.boolean(), receipt });

const splitValues = (value: unknown): string[] => String(value ?? "").split(/[\n,]/u)
  .map((item) => item.trim()).filter(Boolean);

export default function SitesPage(): React.ReactElement {
  const { message } = App.useApp();
  const { siteId, reloadSites } = useAdmin();
  const actionRef = useRef<ActionType>(undefined);
  const [detail, setDetail] = useState<Site | null>(null);
  const columns: ProColumns<Site>[] = [
    { title: "Site", dataIndex: "siteRef", copyable: true, ellipsis: true },
    { title: "状态", dataIndex: "status", render: (_, row) => <Tag color="blue">{row.status}</Tag> },
    { title: "安全代次", dataIndex: "securityEpoch", width: 120 },
    { title: "操作", valueType: "option", render: (_, row) => <Button type="link" onClick={async () => {
      try { setDetail(await apiGet(`/api/control/sites/${encodeURIComponent(row.siteRef)}`, site)); }
      catch (error) { message.error(error instanceof Error ? error.message : "加载失败"); }
    }}>详情</Button> },
  ];

  return <PageContainer header={{ title: "站点与发布" }}
    content="中央 Admin 通过 Platform typed control plane 管理独立 Site。站点注册使用全局授权；发布只使用当前选中的 Site 授权。"
    extra={<Space wrap>
      <Button href="/api/control/auth/step-up?operation=site.register&resource=platform-sites&return=/sites">提升注册认证</Button>
      <RegisterSite actionRef={actionRef} reloadSites={reloadSites} />
      <Button disabled={!siteId}
        href={siteId ? `/api/control/auth/step-up?operation=site.release.publish&resource=${encodeURIComponent(siteId)}&return=/sites` : undefined}>
        提升发布认证
      </Button>
      <PublishRelease siteId={siteId} actionRef={actionRef} />
    </Space>}>
    <ProTable<Site> actionRef={actionRef} rowKey="siteRef" columns={columns} search={false} pagination={false}
      options={{ reload: true, density: true }} request={async () => { try {
        const result = await apiGet("/api/control/sites", siteList);
        return { data: result.items, success: true, total: result.items.length };
      } catch (error) { message.error(error instanceof Error ? error.message : "加载失败");
        return { data: [], success: false, total: 0 }; } }} />
    <Modal title="站点详情" open={detail !== null} footer={null} onCancel={() => setDetail(null)} destroyOnHidden>
      {detail && <Descriptions column={1} items={[
        { key: "site", label: "Site", children: detail.siteRef },
        { key: "status", label: "状态", children: detail.status },
        { key: "epoch", label: "安全代次", children: detail.securityEpoch },
      ]} />}
    </Modal>
  </PageContainer>;
}

function RegisterSite({ actionRef, reloadSites }: Readonly<{
  actionRef: React.RefObject<ActionType | undefined>; reloadSites: () => void;
}>): React.ReactElement {
  const { message } = App.useApp();
  return <ModalForm title="注册站点" trigger={<Button type="primary">注册站点</Button>} width={680}
    modalProps={{ destroyOnHidden: true }} onFinish={async (values) => { try {
      await apiPost("/api/control/sites", {
        siteId: String(values.siteId), siteKey: String(values.siteKey),
        projectBindingRef: String(values.projectBindingRef), repositoryRef: String(values.repositoryRef),
        providerNamespace: String(values.providerNamespace), providerProjectRef: String(values.providerProjectRef),
        workloadIdentityRef: String(values.workloadIdentityRef),
      }, registered);
      message.success("站点已进入 preview_ready"); reloadSites(); actionRef.current?.reload(); return true;
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

function PublishRelease({ siteId, actionRef }: Readonly<{
  siteId: string; actionRef: React.RefObject<ActionType | undefined>;
}>): React.ReactElement {
  const { message } = App.useApp();
  return <ModalForm title="发布已认证 SiteRelease" trigger={<Button type="primary" disabled={!siteId}>发布 release</Button>}
    width={760} modalProps={{ destroyOnHidden: true }} onFinish={async (values) => { try {
      await apiPost("/api/control/sites/releases", {
        siteId, releaseRef: String(values.releaseRef), webArtifactDigest: String(values.webArtifactDigest),
        releaseManifestDigest: String(values.releaseManifestDigest), certificationDigest: String(values.certificationDigest),
        launchProfileRef: String(values.launchProfileRef), siteConfigRevisionRef: String(values.siteConfigRevisionRef),
        legalRevisionRef: String(values.legalRevisionRef), featurePolicyRevision: String(values.featurePolicyRevision),
        modelOptionCatalogRef: String(values.modelOptionCatalogRef), agentCatalogRef: String(values.agentCatalogRef),
        identityIssuerLabel: String(values.identityIssuerLabel),
        identityAuthStrengthPolicyRevision: String(values.identityAuthStrengthPolicyRevision),
        enabledSurfaceIds: splitValues(values.enabledSurfaceIds),
        localePolicy: { defaultLocale: String(values.defaultLocale), allowedLocales: splitValues(values.allowedLocales) },
        certification: { signingKeyRef: String(values.signingKeyRef), issuedAt: String(values.issuedAt),
          expiresAt: String(values.expiresAt), signatureBase64: String(values.signatureBase64) },
      }, published);
      message.success("SiteRelease 已发布"); actionRef.current?.reload(); return true;
    } catch (error) { message.error(error instanceof Error ? error.message : "发布失败"); return false; } }}>
    <ProFormText name="releaseRef" label="Release ref" rules={[{ required: true }]} />
    <ProFormText name="webArtifactDigest" label="Web artifact SHA-256" rules={[{ required: true }]} />
    <ProFormText name="releaseManifestDigest" label="Release manifest SHA-256" rules={[{ required: true }]} />
    <ProFormText name="certificationDigest" label="Certification facts SHA-256" rules={[{ required: true }]} />
    <ProFormText name="launchProfileRef" label="Launch profile ref" rules={[{ required: true }]} />
    <ProFormText name="siteConfigRevisionRef" label="Site config revision ref" rules={[{ required: true }]} />
    <ProFormText name="legalRevisionRef" label="Legal revision ref" rules={[{ required: true }]} />
    <ProFormText name="featurePolicyRevision" label="Feature policy revision" rules={[{ required: true }]} />
    <ProFormText name="modelOptionCatalogRef" label="Model option catalog ref" rules={[{ required: true }]} />
    <ProFormText name="agentCatalogRef" label="Agent catalog ref" rules={[{ required: true }]} />
    <ProFormText name="identityIssuerLabel" label="Identity issuer label" rules={[{ required: true }]} />
    <ProFormText name="identityAuthStrengthPolicyRevision" label="Identity auth-strength policy revision"
      rules={[{ required: true }]} />
    <ProFormTextArea name="enabledSurfaceIds" label="Enabled surface IDs（逗号或换行）" initialValue="chat"
      rules={[{ required: true }]} />
    <ProFormText name="defaultLocale" label="Default locale" initialValue="en" rules={[{ required: true }]} />
    <ProFormTextArea name="allowedLocales" label="Allowed locales（逗号或换行）" initialValue="en"
      rules={[{ required: true }]} />
    <ProFormText name="signingKeyRef" label="CI/release signing key ref" rules={[{ required: true }]} />
    <ProFormText name="issuedAt" label="Proof issued_at（ISO 8601）" rules={[{ required: true }]} />
    <ProFormText name="expiresAt" label="Proof expires_at（ISO 8601）" rules={[{ required: true }]} />
    <ProFormTextArea name="signatureBase64" label="CI/release authority signature（Base64，仅签名，不提交私钥）"
      fieldProps={{ rows: 4 }} rules={[{ required: true }]} />
  </ModalForm>;
}
