"use client";

import { Tag } from "antd";
import type { ProColumns } from "@ant-design/pro-components";

import { PublishCreditProgramForm } from "@/components/commerce/commerce-publish-forms";
import { CommerceResourceList } from "@/components/commerce/commerce-resource-list";
import { useAdmin } from "@/components/shell/app-shell";
import { commerceAccessPlan } from "@/lib/commerce-permissions";
import type { AdminCreditProgram } from "@/lib/commerce-contract";

const columns: ProColumns<AdminCreditProgram>[] = [
  { title: "Revision ref", dataIndex: "creditProgramRevisionRef", copyable: true, ellipsis: true },
  { title: "Program", dataIndex: "programRef", ellipsis: true },
  { title: "Revision", dataIndex: "revision", width: 90 },
  { title: "Bucket", dataIndex: "bucketClass", width: 110,
    render: (_, row) => <Tag color="green">{row.bucketClass}</Tag> },
  { title: "额度", render: (_, row) => `${row.amount} ${row.unit}`, width: 150 },
  { title: "发布时间", dataIndex: "publishedAt", valueType: "dateTime", width: 190 },
];

export default function CreditProgramsPage(): React.ReactElement {
  const { siteId, me } = useAdmin();
  const access = commerceAccessPlan(me?.permissions ?? []).creditPrograms;
  return <CommerceResourceList<AdminCreditProgram>
    resource="credit-programs"
    title="Credit Programs"
    description="Commerce 拥有的不可变 Credit Program revision；Credit 只消费已选 revision。"
    detailBase="/commerce/credit-programs"
    readPermission="commerce.credit-program.read"
    columns={columns}
    extra={<PublishCreditProgramForm siteId={siteId} enabled={access.publish} />}
  />;
}
