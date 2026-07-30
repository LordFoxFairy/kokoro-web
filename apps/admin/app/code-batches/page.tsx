"use client";

import { useRef, useState } from "react";
import { App, Button, Input, Modal, Space, Tag, Typography } from "antd";
import { PageContainer, ProTable, ModalForm, ProFormDigit, ProFormText,
  type ActionType, type ProColumns } from "@ant-design/pro-components";
import { z } from "zod";
import { apiGet, apiPost } from "@/lib/api";
import { useAdmin } from "@/components/shell/app-shell";

const batch = z.object({ batchRef: z.string(), redemptionProgramRevisionRef: z.string(), state: z.string(),
  approvalState: z.string(), inventoryCount: z.number(), createdByOperatorRef: z.string(), createdAt: z.string(),
  activatedAt: z.string().nullable() });
type Batch = z.infer<typeof batch>;
const list = z.object({ items: z.array(batch), nextPageToken: z.string().nullable() });
const receipt = z.object({ commandId: z.string(), state: z.string() });
const issueResult = z.object({ batchRef: z.string(), rawCodes: z.array(z.string()), receipt });
const actionResult = z.object({ batchRef: z.string(), receipt });
const programResult = z.object({ redemptionProgramRevisionRef: z.string(), receipt });

export default function CodeBatchesPage(): React.ReactElement {
  const { message } = App.useApp(); const { siteId } = useAdmin(); const actionRef = useRef<ActionType>(undefined);
  const [secretExport, setSecretExport] = useState<{ batchRef: string; codes: string[] } | null>(null);
  async function mutate(action: "approve" | "activate" | "suspend" | "revoke", row: Batch) {
    const query = new URLSearchParams(window.location.search);
    if (query.get("ready") !== action || query.get("batch") !== row.batchRef) {
      const operation = `commerce.code-batch.${action}`;
      const back = `/code-batches?ready=${encodeURIComponent(action)}&batch=${encodeURIComponent(row.batchRef)}`;
      window.location.href = `/api/control/auth/step-up?operation=${encodeURIComponent(operation)}&resource=${encodeURIComponent(siteId)}&resource=${encodeURIComponent(row.batchRef)}&return=${encodeURIComponent(back)}`;
      return;
    }
    const reason = window.prompt(`${action} 理由`); if (!reason) return;
    try { await apiPost(`/api/control/code-batches/${row.batchRef}/${action}`, { reason }, actionResult);
      message.success("状态已更新"); actionRef.current?.reload(); } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败"); }
  }
  function download(): void {
    if (!secretExport) return;
    const blob = new Blob([`${secretExport.codes.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `kokoro-${secretExport.batchRef}.txt`; anchor.click();
    URL.revokeObjectURL(url);
  }
  const columns: ProColumns<Batch>[] = [
    { title: "批次", dataIndex: "batchRef", copyable: true, ellipsis: true },
    { title: "兑换计划", dataIndex: "redemptionProgramRevisionRef", ellipsis: true },
    { title: "库存", dataIndex: "inventoryCount", width: 80 },
    { title: "状态", render: (_, row) => <Space><Tag>{row.state}</Tag><Tag color={row.approvalState.includes("approved") ? "green" : "gold"}>{row.approvalState}</Tag></Space> },
    { title: "创建时间", dataIndex: "createdAt", valueType: "dateTime", width: 180 },
    { title: "操作", valueType: "option", width: 260, render: (_, row) => [
      <a key="approve" onClick={() => mutate("approve", row)}>批准</a>,
      <a key="activate" onClick={() => mutate("activate", row)}>启用</a>,
      <a key="suspend" onClick={() => mutate("suspend", row)}>暂停</a>,
      <a key="revoke" style={{ color: "#c2410c" }} onClick={() => mutate("revoke", row)}>撤销</a>,
    ] },
  ];
  return <PageContainer header={{ title: "卡密批次" }} content="卡密只在创建成功的首次响应中出现；关闭导出窗口后无法恢复。"
    extra={<Space>
      <Button href={`/api/control/auth/step-up?operation=commerce.redemption-program.publish&resource=${encodeURIComponent(siteId)}&return=/code-batches`}>提升计划发布认证</Button>
      <ModalForm title="发布兑换计划" trigger={<Button>发布兑换计划</Button>} width={560}
        modalProps={{ destroyOnHidden: true }} onFinish={async (values) => { try {
          await apiPost("/api/control/redemption-programs", {
            redemptionProgramRevisionRef: String(values.redemptionProgramRevisionRef),
            programRef: String(values.programRef), revision: Number(values.revision),
            productVersionRef: String(values.productVersionRef),
            fulfillmentProgramRevisionRef: String(values.fulfillmentProgramRevisionRef),
            maxRedemptionsPerAccount: Number(values.maxRedemptionsPerAccount),
          }, programResult); message.success("兑换计划已发布"); return true;
        } catch (error) { message.error(error instanceof Error ? error.message : "发布失败"); return false; } }}>
        <ProFormText name="redemptionProgramRevisionRef" label="兑换计划 revision ref" rules={[{ required: true }]} />
        <ProFormText name="programRef" label="Program ref" rules={[{ required: true }]} />
        <ProFormDigit name="revision" label="Revision" min={1} initialValue={1} rules={[{ required: true }]} />
        <ProFormText name="productVersionRef" label="Product version ref" rules={[{ required: true }]} />
        <ProFormText name="fulfillmentProgramRevisionRef" label="Fulfillment revision ref" rules={[{ required: true }]} />
        <ProFormDigit name="maxRedemptionsPerAccount" label="每账户最大兑换次数" min={1} max={10000} initialValue={1} rules={[{ required: true }]} />
      </ModalForm>
      <Button href={`/api/control/auth/step-up?operation=commerce.code-batch.issue&resource=${encodeURIComponent(siteId)}&return=/code-batches`}>提升签发认证</Button><ModalForm title="签发卡密批次" trigger={<Button type="primary">签发批次</Button>} width={520}
      modalProps={{ destroyOnHidden: true }} onFinish={async (values) => { try {
        const result = await apiPost("/api/control/code-batches", { batchRef: crypto.randomUUID(),
          redemptionProgramRevisionRef: String(values.redemptionProgramRevisionRef), count: Number(values.count),
          ...(values.startsAt ? { startsAt: String(values.startsAt) } : {}),
          ...(values.endsAt ? { endsAt: String(values.endsAt) } : {}) }, issueResult);
        setSecretExport({ batchRef: result.batchRef, codes: [...result.rawCodes] });
        actionRef.current?.reload(); return true;
      } catch (error) { message.error(error instanceof Error ? error.message : "签发失败"); return false; } }}>
      <ProFormText name="redemptionProgramRevisionRef" label="兑换计划 revision ref" rules={[{ required: true }]} />
      <ProFormDigit name="count" label="数量" min={1} max={1000} initialValue={100} rules={[{ required: true }]} />
      <ProFormText name="startsAt" label="开始时间（ISO，可选）" />
      <ProFormText name="endsAt" label="结束时间（ISO，可选）" />
    </ModalForm></Space>}>
    <ProTable<Batch> actionRef={actionRef} rowKey="batchRef" columns={columns} search={false} pagination={false}
      params={{ siteId }} options={{ reload: true, density: true }} request={async () => { if (!siteId) return { data: [], success: true, total: 0 }; try { const result = await apiGet(`/api/control/code-batches?siteId=${encodeURIComponent(siteId)}`, list); return { data: result.items, success: true, total: result.items.length }; } catch (error) { message.error(error instanceof Error ? error.message : "加载失败"); return { data: [], success: false, total: 0 }; } }} />
    <Modal open={secretExport !== null} title="一次性卡密导出" closable={false} maskClosable={false}
      okText="下载后关闭" cancelText="关闭并销毁" onOk={() => { download(); setSecretExport(null); }}
      onCancel={() => setSecretExport(null)} destroyOnHidden>
      <Typography.Paragraph type="warning">这些卡密不会再次显示。请立即下载并转移到受控存储。</Typography.Paragraph>
      <Input.TextArea readOnly rows={12} value={secretExport?.codes.join("\n") ?? ""} />
    </Modal>
  </PageContainer>;
}
