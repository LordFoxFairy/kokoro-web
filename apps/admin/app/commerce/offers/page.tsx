"use client";

import { Tag } from "antd";
import type { ProColumns } from "@ant-design/pro-components";

import { PublishOfferForm } from "@/components/commerce/commerce-publish-forms";
import { CommerceResourceList } from "@/components/commerce/commerce-resource-list";
import { useAdmin } from "@/components/shell/app-shell";
import type { AdminOffer } from "@/lib/commerce-contract";
import { commerceAccessPlan } from "@/lib/commerce-permissions";

const columns: ProColumns<AdminOffer>[] = [
  { title: "Product version", dataIndex: "productVersionRef", copyable: true, ellipsis: true },
  { title: "Product", dataIndex: "productRef", ellipsis: true },
  { title: "Label", dataIndex: "safeLabel" },
  { title: "Kind", dataIndex: "productKind", width: 130,
    render: (_, row) => <Tag color="blue">{row.productKind}</Tag> },
  { title: "Revision", dataIndex: "revision", width: 90 },
  { title: "输出", render: (_, row) => `${row.outputs.length} 项`, width: 90 },
  { title: "发布时间", dataIndex: "publishedAt", valueType: "dateTime", width: 190 },
];

export default function OffersPage(): React.ReactElement {
  const { siteId, me } = useAdmin();
  const access = commerceAccessPlan(me?.permissions ?? []).offers;
  return <CommerceResourceList<AdminOffer> resource="offers" title="Offers"
    description="冻结产品、Plan、Fulfillment outputs 与法律条款的不可变 Offer revision。"
    detailBase="/commerce/offers" readPermission="commerce.offer.read" columns={columns}
    extra={<PublishOfferForm siteId={siteId} enabled={access.publish} />} />;
}
