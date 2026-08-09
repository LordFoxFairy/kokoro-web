"use client";

import { Tag } from "antd";
import type { ProColumns } from "@ant-design/pro-components";

import { PublishRedemptionProgramForm } from "@/components/commerce/commerce-publish-forms";
import { CommerceResourceList } from "@/components/commerce/commerce-resource-list";
import { useAdmin } from "@/components/shell/app-shell";
import type { AdminRedemptionProgram } from "@/lib/commerce-contract";
import { commerceAccessPlan } from "@/lib/commerce-permissions";

const columns: ProColumns<AdminRedemptionProgram>[] = [
  { title: "Revision ref", dataIndex: "redemptionProgramRevisionRef", copyable: true, ellipsis: true },
  { title: "Program", dataIndex: "programRef", ellipsis: true },
  { title: "Offer", dataIndex: "productVersionRef", ellipsis: true },
  { title: "状态", dataIndex: "availabilityState", width: 100,
    render: (_, row) => <Tag color={row.availabilityState === "active" ? "green" : "default"}>
      {row.availabilityState}</Tag> },
  { title: "每账户次数", dataIndex: "maxRedemptionsPerAccount", width: 120 },
  { title: "发布时间", dataIndex: "publishedAt", valueType: "dateTime", width: 190 },
];

export default function RedemptionProgramsPage(): React.ReactElement {
  const { siteId, me } = useAdmin();
  const access = commerceAccessPlan(me?.permissions ?? []).redemptionPrograms;
  return <CommerceResourceList<AdminRedemptionProgram> resource="redemption-programs"
    title="Redemption Programs" description="将 Offer 与 Fulfillment revision 绑定到兑换规则。"
    detailBase="/commerce/redemption-programs" readPermission="commerce.redemption-program.read"
    columns={columns} extra={<PublishRedemptionProgramForm siteId={siteId} enabled={access.publish} />} />;
}
