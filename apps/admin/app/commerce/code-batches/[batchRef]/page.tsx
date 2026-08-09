"use client";

import { useParams } from "next/navigation";
import type { ProDescriptionsItemProps } from "@ant-design/pro-components";

import { CommerceResourceDetail } from "@/components/commerce/commerce-resource-detail";
import type { AdminCodeBatch } from "@/lib/commerce-contract";

const columns: ProDescriptionsItemProps<AdminCodeBatch>[] = [
  { title: "Batch ref", dataIndex: "batchRef", copyable: true },
  { title: "Redemption revision", dataIndex: "redemptionProgramRevisionRef" },
  { title: "状态", dataIndex: "state" },
  { title: "审批", dataIndex: "approvalState" },
  { title: "库存", dataIndex: "inventoryCount" },
  { title: "Maker", dataIndex: "createdByOperatorRef" },
  { title: "Starts at", dataIndex: "startsAt", valueType: "dateTime" },
  { title: "Ends at", dataIndex: "endsAt", valueType: "dateTime" },
  { title: "创建时间", dataIndex: "createdAt", valueType: "dateTime" },
  { title: "激活时间", dataIndex: "activatedAt", valueType: "dateTime" },
];

export default function CodeBatchDetailPage(): React.ReactElement {
  const { batchRef } = useParams<{ batchRef: string }>();
  return <CommerceResourceDetail<AdminCodeBatch> resource="code-batches" id={batchRef}
    title="Code Batch 详情" listPath="/commerce/code-batches"
    readPermission="commerce.code-batch.read" columns={columns} />;
}
