"use client";

import { useParams } from "next/navigation";
import type { ProDescriptionsItemProps } from "@ant-design/pro-components";

import { CommerceResourceDetail } from "@/components/commerce/commerce-resource-detail";
import type { AdminOffer } from "@/lib/commerce-contract";

const columns: ProDescriptionsItemProps<AdminOffer>[] = [
  { title: "Product version", dataIndex: "productVersionRef", copyable: true },
  { title: "Product ref", dataIndex: "productRef" },
  { title: "Product kind", dataIndex: "productKind" },
  { title: "Revision", dataIndex: "revision" },
  { title: "Safe label", dataIndex: "safeLabel" },
  { title: "Fulfillment revision", dataIndex: "fulfillmentProgramRevisionRef" },
  { title: "发布时间", dataIndex: "publishedAt", valueType: "dateTime" },
];

export default function OfferDetailPage(): React.ReactElement {
  const { revisionRef } = useParams<{ revisionRef: string }>();
  return <CommerceResourceDetail<AdminOffer> resource="offers" id={revisionRef} title="Offer 详情"
    listPath="/commerce/offers" readPermission="commerce.offer.read" columns={columns} />;
}
