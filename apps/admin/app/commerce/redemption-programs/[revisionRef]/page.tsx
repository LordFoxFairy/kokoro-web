"use client";

import { useParams } from "next/navigation";
import type { ProDescriptionsItemProps } from "@ant-design/pro-components";

import { CommerceResourceDetail } from "@/components/commerce/commerce-resource-detail";
import type { AdminRedemptionProgram } from "@/lib/commerce-contract";

const columns: ProDescriptionsItemProps<AdminRedemptionProgram>[] = [
  { title: "Revision ref", dataIndex: "redemptionProgramRevisionRef", copyable: true },
  { title: "Program ref", dataIndex: "programRef" },
  { title: "Revision", dataIndex: "revision" },
  { title: "Product version", dataIndex: "productVersionRef" },
  { title: "Fulfillment revision", dataIndex: "fulfillmentProgramRevisionRef" },
  { title: "每账户最大兑换", dataIndex: "maxRedemptionsPerAccount" },
  { title: "状态", dataIndex: "availabilityState" },
  { title: "发布时间", dataIndex: "publishedAt", valueType: "dateTime" },
];

export default function RedemptionProgramDetailPage(): React.ReactElement {
  const { revisionRef } = useParams<{ revisionRef: string }>();
  return <CommerceResourceDetail<AdminRedemptionProgram> resource="redemption-programs" id={revisionRef}
    title="Redemption Program 详情" listPath="/commerce/redemption-programs"
    readPermission="commerce.redemption-program.read" columns={columns} />;
}
