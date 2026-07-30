"use client";

import { useRef } from "react";
import { App, Button, Space, Tag } from "antd";
import { PageContainer, ProTable, ModalForm, ProFormDigit, ProFormSelect, ProFormText,
  ProFormTextArea, type ActionType, type ProColumns } from "@ant-design/pro-components";
import { z } from "zod";
import { apiGet, apiPost } from "@/lib/api";
import { useAdmin } from "@/components/shell/app-shell";

const offer = z.object({ siteId: z.string(), productRef: z.string(), productVersionRef: z.string(), revision: z.string(),
  safeLabel: z.string(), planVersionRef: z.string().nullable(), fulfillmentProgramRevisionRef: z.string(), publishedAt: z.string() });
type Offer = z.infer<typeof offer>;
const list = z.object({ items: z.array(offer), nextPageToken: z.string().nullable() });
const mutation = z.object({ productVersionRef: z.string(), receipt: z.object({ commandId: z.string(), state: z.string() }) });
const output = z.object({ lineId: z.string(), ordinal: z.number().int().nonnegative(), cardinality: z.number().int().positive(),
  kind: z.enum(["subscription_term", "entitlement_grant", "credit_grant"]), targetRef: z.string() });

export default function OffersPage(): React.ReactElement {
  const { message } = App.useApp(); const { siteId } = useAdmin(); const actionRef = useRef<ActionType>(undefined);
  const columns: ProColumns<Offer>[] = [
    { title: "商品", dataIndex: "safeLabel" },
    { title: "Product ref", dataIndex: "productRef", copyable: true, ellipsis: true },
    { title: "版本", dataIndex: "productVersionRef", copyable: true, ellipsis: true },
    { title: "修订", dataIndex: "revision", width: 80 },
    { title: "套餐", render: (_, row) => row.planVersionRef ? <Tag color="blue">{row.planVersionRef}</Tag> : "—" },
    { title: "发布时间", dataIndex: "publishedAt", valueType: "dateTime", width: 180 },
  ];
  return <PageContainer header={{ title: "套餐与商品" }} content="原子发布 Product、PlanVersion 与 Fulfillment Program；发布后版本不可变。"
    extra={<Space><Button href={`/api/control/auth/step-up?operation=commerce.offer.publish&resource=${encodeURIComponent(siteId)}&return=/offers`}>提升发布认证</Button><ModalForm title="发布商品" trigger={<Button type="primary">发布商品</Button>} width={680}
      modalProps={{ destroyOnHidden: true }} onFinish={async (values) => { try {
        const outputs = z.array(output).min(1).parse(JSON.parse(String(values.outputs)));
        const plan = String(values.plan ?? "").trim();
        await apiPost("/api/control/offers", { productRef: String(values.productRef),
          productVersionRef: String(values.productVersionRef), productKind: values.productKind,
          revision: Number(values.revision), safeLabel: String(values.safeLabel),
          fulfillmentProgramRef: String(values.fulfillmentProgramRef),
          fulfillmentProgramRevisionRef: String(values.fulfillmentProgramRevisionRef),
          fulfillmentProgramRevision: Number(values.fulfillmentProgramRevision), outputs,
          legalTermRefs: String(values.legalTermRefs ?? "").split("\n").map((v) => v.trim()).filter(Boolean),
          ...(plan ? { plan: JSON.parse(plan) as unknown } : {}) }, mutation);
        message.success("商品版本已发布"); actionRef.current?.reload(); return true;
      } catch (error) { message.error(error instanceof Error ? error.message : "发布失败"); return false; } }}>
      <ProFormText name="productRef" label="Product ref" rules={[{ required: true }]} />
      <ProFormText name="productVersionRef" label="Product version ref" rules={[{ required: true }]} />
      <ProFormSelect name="productKind" label="商品类型" initialValue="credit_pack" options={[
        { value: "credit_pack", label: "积分包" }, { value: "subscription", label: "订阅" }, { value: "bundle", label: "组合包" }]} />
      <ProFormDigit name="revision" label="Product revision" min={1} initialValue={1} rules={[{ required: true }]} />
      <ProFormText name="safeLabel" label="展示名称" rules={[{ required: true }]} />
      <ProFormText name="fulfillmentProgramRef" label="Fulfillment program ref" rules={[{ required: true }]} />
      <ProFormText name="fulfillmentProgramRevisionRef" label="Fulfillment revision ref" rules={[{ required: true }]} />
      <ProFormDigit name="fulfillmentProgramRevision" label="Fulfillment revision" min={1} initialValue={1} rules={[{ required: true }]} />
      <ProFormTextArea name="outputs" label="交付输出（JSON 数组）" fieldProps={{ rows: 5 }} rules={[{ required: true }]}
        initialValue={'[{"lineId":"credit","ordinal":0,"cardinality":1,"kind":"credit_grant","targetRef":"credit-program:v1"}]'} />
      <ProFormTextArea name="plan" label="Plan（可选 JSON）" fieldProps={{ rows: 4 }} />
      <ProFormTextArea name="legalTermRefs" label="法律条款 refs（每行一个）" fieldProps={{ rows: 3 }} />
    </ModalForm></Space>}>
    <ProTable<Offer> actionRef={actionRef} rowKey="productVersionRef" columns={columns} search={false} pagination={false}
      params={{ siteId }} options={{ reload: true, density: true }} request={async () => { if (!siteId) return { data: [], success: true, total: 0 }; try { const result = await apiGet(`/api/control/offers?siteId=${encodeURIComponent(siteId)}`, list); return { data: result.items, success: true, total: result.items.length }; } catch (error) { message.error(error instanceof Error ? error.message : "加载失败"); return { data: [], success: false, total: 0 }; } }} />
  </PageContainer>;
}
