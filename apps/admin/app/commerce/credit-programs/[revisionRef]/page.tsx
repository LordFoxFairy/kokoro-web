"use client";

import { useParams } from "next/navigation";
import type { ProDescriptionsItemProps } from "@ant-design/pro-components";

import { CommerceResourceDetail } from "@/components/commerce/commerce-resource-detail";
import type { AdminCreditProgram } from "@/lib/commerce-contract";

const columns: ProDescriptionsItemProps<AdminCreditProgram>[] = [
  { title: "Revision ref", dataIndex: "creditProgramRevisionRef", copyable: true },
  { title: "Program ref", dataIndex: "programRef" },
  { title: "Revision", dataIndex: "revision" },
  { title: "Bucket", dataIndex: "bucketClass" },
  { title: "Unit", dataIndex: "unit" },
  { title: "Amount", dataIndex: "amount" },
  { title: "Window", dataIndex: "windowKind" },
  { title: "Revision digest", dataIndex: "revisionDigest", copyable: true },
  { title: "发布时间", dataIndex: "publishedAt", valueType: "dateTime" },
];

export default function CreditProgramDetailPage(): React.ReactElement {
  const { revisionRef } = useParams<{ revisionRef: string }>();
  return <CommerceResourceDetail<AdminCreditProgram> resource="credit-programs" id={revisionRef}
    title="Credit Program 详情" listPath="/commerce/credit-programs"
    readPermission="commerce.credit-program.read" columns={columns} />;
}
