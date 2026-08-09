"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, App, Button, Dropdown, Modal, Space, Tag, type MenuProps } from "antd";
import { DownOutlined, DownloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import {
  ModalForm,
  PageContainer,
  ProFormDigit,
  ProFormText,
  ProFormTextArea,
  ProTable,
  type ProColumns,
} from "@ant-design/pro-components";
import { useInfiniteList } from "@refinedev/core";

import { useAdmin } from "@/components/shell/app-shell";
import { apiPost } from "@/lib/api";
import {
  codeBatchMutationResultSchema,
  issueCodeBatchInputSchema,
  issueCodeBatchResultSchema,
  type AdminCodeBatch,
} from "@/lib/commerce-contract";
import { codeBatchActionAccess, commerceAccessPlan } from "@/lib/commerce-permissions";
import { adminInfiniteResult, adminNextPageParam } from "@/lib/refine/admin-data-provider";
import { downloadSensitiveCodes } from "@/lib/sensitive-code-export";

interface SensitiveCodeExport {
  readonly batchRef: string;
  readonly rawCodes: readonly string[];
}

type ReasonAction = "abandon" | "suspend" | "revoke";
type BatchStepUpAction = "approve" | "activate" | ReasonAction;

const BATCH_STEP_UP_OPERATION = Object.freeze({
  approve: "commerce.code-batch.approve",
  activate: "commerce.code-batch.activate",
  abandon: "commerce.code-batch.abandon",
  suspend: "commerce.code-batch.suspend",
  revoke: "commerce.code-batch.revoke",
} as const satisfies Record<BatchStepUpAction, string>);

export function CodeBatchConsole(): React.ReactElement {
  const { siteId, me } = useAdmin();
  const permissions = me?.permissions ?? [];
  const access = commerceAccessPlan(permissions).codeBatches;
  const canRead = access.read;
  const [sensitiveExport, setSensitiveExport] = useState<SensitiveCodeExport | null>(null);
  const [replayBatchRef, setReplayBatchRef] = useState<string | null>(null);
  const [reasonAction, setReasonAction] = useState<Readonly<{
    action: ReasonAction;
    batchRef: string;
  }> | null>(null);
  const filters = useMemo(() => siteId
    ? [{ field: "siteId", operator: "eq" as const, value: siteId }]
    : [], [siteId]);
  const { query } = useInfiniteList<AdminCodeBatch>({
    resource: "code-batches",
    pagination: { mode: "server", currentPage: 1, pageSize: 100 },
    filters,
    queryOptions: { enabled: canRead && siteId.length > 0, getNextPageParam: adminNextPageParam },
  });
  const list = adminInfiniteResult(query.data);
  const listError = query.error ?? list.error;
  const clearSensitiveExport = useCallback(() => { setSensitiveExport(null); }, []);

  useEffect(() => {
    if (sensitiveExport === null) return;
    const timeout = window.setTimeout(clearSensitiveExport, 45_000);
    return () => { window.clearTimeout(timeout); };
  }, [clearSensitiveExport, sensitiveExport]);

  const refresh = () => { void query.refetch(); };
  const columns: ProColumns<AdminCodeBatch>[] = [
    { title: "Batch ref", dataIndex: "batchRef", copyable: true, ellipsis: true },
    { title: "Redemption revision", dataIndex: "redemptionProgramRevisionRef", ellipsis: true },
    { title: "状态", dataIndex: "state", width: 110,
      render: (_, row) => <Tag color={row.state === "active" ? "green" : row.state === "suspended" ? "red" :
        row.state === "draft" ? "gold" : "default"}>{row.state}</Tag> },
    { title: "审批", dataIndex: "approvalState", width: 100,
      render: (_, row) => <Tag color={row.approvalState === "approved" ? "green" : "gold"}>
        {row.approvalState}</Tag> },
    { title: "数量", dataIndex: "inventoryCount", width: 90 },
    { title: "Maker", dataIndex: "createdByOperatorRef", ellipsis: true },
    { title: "创建时间", dataIndex: "createdAt", valueType: "dateTime", width: 180 },
    { title: "操作", valueType: "option", width: 320, render: (_, row) => {
      const actions = codeBatchActionAccess({ permissions, operatorRef: me?.email ?? "", batch: row });
      const stepUpItems = batchStepUpItems(actions);
      return <Space size={4} wrap>
        <Link href={`/commerce/code-batches/${encodeURIComponent(row.batchRef)}`}>详情</Link>
        <Dropdown menu={{ items: stepUpItems, onClick: ({ key }) => {
          if (!Object.hasOwn(BATCH_STEP_UP_OPERATION, key)) return;
          window.location.href = batchStepUpPath(siteId, row.batchRef, key as BatchStepUpAction);
        } }} disabled={stepUpItems.length === 0}>
          <Button type="link" size="small" icon={<SafetyCertificateOutlined />}>提升状态操作认证</Button>
        </Dropdown>
        <Button type="link" size="small" disabled={!actions.approve}
          onClick={() => { void simpleAction("approve", row.batchRef, refresh); }}>Checker 批准</Button>
        <Button type="link" size="small" disabled={!actions.activate}
          onClick={() => { void simpleAction("activate", row.batchRef, refresh); }}>激活</Button>
        <Button type="link" size="small" disabled={!actions.abandon}
          onClick={() => setReasonAction({ action: "abandon", batchRef: row.batchRef })}>放弃</Button>
        <Button type="link" danger size="small" disabled={!actions.suspend}
          onClick={() => setReasonAction({ action: "suspend", batchRef: row.batchRef })}>暂停</Button>
        <Button type="link" danger size="small" disabled={!actions.revoke}
          onClick={() => setReasonAction({ action: "revoke", batchRef: row.batchRef })}>撤销</Button>
      </Space>;
    } },
  ];
  const { message } = App.useApp();

  async function simpleAction(action: "approve" | "activate", batchRef: string,
    onSuccess: () => void): Promise<void> {
    try {
      await apiPost(`/api/control/commerce/code-batches/${encodeURIComponent(batchRef)}/${action}`,
        { siteId }, codeBatchMutationResultSchema);
      message.success(action === "approve" ? "独立 Checker 已批准批次" : "批次已激活");
      onSuccess();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批次操作失败；请确认已完成对应 step-up");
    }
  }

  return (
    <PageContainer header={{ title: "Code Batches" }}
      content={`卡密只在首次签发响应中交付一次。${siteId ? ` 当前 Site：${siteId}` : ""}`}
      extra={<IssueCodeBatchForm siteId={siteId} enabled={access.issue}
        onSensitiveExport={setSensitiveExport} onReplay={setReplayBatchRef} onIssued={refresh} />}>
      {!siteId && <Alert type="warning" showIcon message="请先选择 Site" style={{ marginBottom: 16 }} />}
      {!canRead && <Alert type="error" showIcon message="当前操作员没有卡密批次读取权限"
        style={{ marginBottom: 16 }} />}
      {replayBatchRef && <Alert type="error" showIcon closable onClose={() => setReplayBatchRef(null)}
        message="本次 Issue 是 command replay，原始卡密不会再次交付"
        description={`批次 ${replayBatchRef} 必须放弃原批次并使用新批次、新 command 重新签发（abandon_and_reissue）。`}
        style={{ marginBottom: 16 }} />}
      {listError && <Alert type="error" showIcon message="批次列表加载失败" description={listError.message}
        style={{ marginBottom: 16 }} />}
      <Alert type="warning" showIcon message="暂停后不可恢复，只能撤销"
        description="Suspend 是 terminal-like 状态；不存在 resume 操作。" style={{ marginBottom: 16 }} />
      <ProTable<AdminCodeBatch> rowKey="batchRef" columns={columns} search={false} pagination={false}
        dataSource={list.records}
        loading={query.isLoading || (query.isFetching && !query.isFetchingNextPage)}
        options={{ reload: refresh, density: true }}
        toolBarRender={() => query.hasNextPage ? [<Button key="load-more" icon={<DownOutlined />}
          loading={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>加载更多</Button>] : []} />

      <ReasonActionForm siteId={siteId} selected={reasonAction} onClose={() => setReasonAction(null)}
        onSuccess={refresh} />

      <Modal
        title="一次性敏感卡密导出"
        open={sensitiveExport !== null}
        closable={false}
        maskClosable={false}
        keyboard={false}
        destroyOnHidden
        onCancel={clearSensitiveExport}
        footer={[
          <Button key="discard" danger onClick={clearSensitiveExport}>放弃并清空</Button>,
          <Button key="download" type="primary" icon={<DownloadOutlined />} onClick={() => {
            if (sensitiveExport === null) return;
            try { downloadSensitiveCodes(sensitiveExport.rawCodes, sensitiveExport.batchRef); }
            finally { setSensitiveExport(null); }
          }}>下载 Blob 并清空</Button>,
        ]}
      >
        <Alert type="error" showIcon message="此窗口不会再次出现"
          description={`共 ${sensitiveExport?.rawCodes.length ?? 0} 条。内容不进入列表缓存、通知、URL、浏览器存储或剪贴板；45 秒后自动清空。`} />
      </Modal>
    </PageContainer>
  );
}

function IssueCodeBatchForm({ siteId, enabled, onSensitiveExport, onReplay, onIssued }: Readonly<{
  siteId: string;
  enabled: boolean;
  onSensitiveExport: (value: SensitiveCodeExport) => void;
  onReplay: (batchRef: string) => void;
  onIssued: () => void;
}>): React.ReactElement {
  const { message } = App.useApp();
  const stepUp = siteId ? "/api/control/auth/step-up?operation=commerce.code-batch.issue" +
    `&resource=${encodeURIComponent(siteId)}&return=${encodeURIComponent("/commerce/code-batches")}` : undefined;
  return <Space wrap>
    <Button href={stepUp} disabled={!enabled || !siteId} icon={<SafetyCertificateOutlined />}>提升签发认证</Button>
    <ModalForm<Record<string, unknown>> title="签发一次性卡密批次"
      trigger={<Button type="primary" disabled={!enabled || !siteId}>签发批次</Button>}
      modalProps={{ destroyOnHidden: true }}
      onFinish={async (values) => {
        try {
          const input = issueCodeBatchInputSchema.parse({ siteId, batchRef: text(values.batchRef),
            redemptionProgramRevisionRef: text(values.redemptionProgramRevisionRef),
            count: integer(values.count), ...optionalText("startsAt", values.startsAt),
            ...optionalText("endsAt", values.endsAt) });
          const result = await apiPost("/api/control/commerce/code-batches", input, issueCodeBatchResultSchema);
          if (result.delivery.kind === "secret_export") {
            onSensitiveExport({ batchRef: result.batchRef, rawCodes: result.delivery.rawCodes });
          } else if (result.delivery.requiredAction === "abandon_and_reissue") {
            onReplay(result.batchRef);
          }
          onIssued();
          return true;
        } catch (error) {
          message.error(error instanceof Error ? error.message : "签发失败；请确认已完成 step-up");
          return false;
        }
      }}>
      <ProFormText name="batchRef" label="新 Batch UUID" rules={[{ required: true }]} />
      <ProFormText name="redemptionProgramRevisionRef" label="Redemption Program revision ref"
        rules={[{ required: true }]} />
      <ProFormDigit name="count" label="卡密数量" min={1} max={1000} initialValue={1}
        rules={[{ required: true }]} />
      <ProFormText name="startsAt" label="Starts at（ISO-8601，可选）" />
      <ProFormText name="endsAt" label="Ends at（ISO-8601，可选）" />
    </ModalForm>
  </Space>;
}

function ReasonActionForm({ siteId, selected, onClose, onSuccess }: Readonly<{
  siteId: string;
  selected: Readonly<{ action: ReasonAction; batchRef: string }> | null;
  onClose: () => void;
  onSuccess: () => void;
}>): React.ReactElement {
  const { message } = App.useApp();
  const title = selected?.action === "suspend" ? "暂停批次（不可恢复）" :
    selected?.action === "revoke" ? "撤销批次" : "放弃批次";
  return <ModalForm<Record<string, unknown>> title={title} open={selected !== null}
    onOpenChange={(open) => { if (!open) onClose(); }} modalProps={{ destroyOnHidden: true }}
    onFinish={async (values) => {
      if (selected === null) return false;
      try {
        await apiPost(`/api/control/commerce/code-batches/${encodeURIComponent(selected.batchRef)}/${selected.action}`,
          { siteId, reason: text(values.reason) }, codeBatchMutationResultSchema);
        message.success("批次状态已更新");
        onClose();
        onSuccess();
        return true;
      } catch (error) {
        message.error(error instanceof Error ? error.message : "批次操作失败；请确认已完成对应 step-up");
        return false;
      }
    }}>
    {selected?.action === "suspend" && <Alert type="error" showIcon message="暂停后不可恢复，只能撤销"
      style={{ marginBottom: 16 }} />}
    <ProFormTextArea name="reason" label="操作原因" fieldProps={{ rows: 4 }} rules={[{ required: true }]} />
  </ModalForm>;
}

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function integer(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : Number.NaN;
}
function optionalText<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  const parsed = text(value);
  return parsed.length === 0 ? {} : { [key]: parsed } as Partial<Record<Key, string>>;
}

function batchStepUpItems(actions: Readonly<Record<BatchStepUpAction, boolean>>): NonNullable<MenuProps["items"]> {
  const labels: Readonly<Record<BatchStepUpAction, string>> = {
    approve: "批准认证", activate: "激活认证", abandon: "放弃认证", suspend: "暂停认证", revoke: "撤销认证",
  };
  return (Object.keys(BATCH_STEP_UP_OPERATION) as BatchStepUpAction[])
    .filter((action) => actions[action])
    .map((action) => ({ key: action, label: labels[action] }));
}

function batchStepUpPath(siteId: string, batchRef: string, action: BatchStepUpAction): string {
  return `/api/control/auth/step-up?operation=${encodeURIComponent(BATCH_STEP_UP_OPERATION[action])}` +
    `&resource=${encodeURIComponent(siteId)}&resource=${encodeURIComponent(batchRef)}` +
    `&return=${encodeURIComponent("/commerce/code-batches")}`;
}
