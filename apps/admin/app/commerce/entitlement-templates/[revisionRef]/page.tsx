"use client";

import { useParams } from "next/navigation";
import type { ProDescriptionsItemProps } from "@ant-design/pro-components";

import { CommerceResourceDetail } from "@/components/commerce/commerce-resource-detail";
import type { AdminEntitlementTemplate } from "@/lib/commerce-contract";

const columns: ProDescriptionsItemProps<AdminEntitlementTemplate>[] = [
  { title: "Revision ref", dataIndex: "entitlementTemplateRevisionRef", copyable: true },
  { title: "Template ref", dataIndex: "templateRef" },
  { title: "Revision", dataIndex: "revision" },
  { title: "Safe label", dataIndex: "safeLabel" },
  { title: "Capability", dataIndex: "capabilityKey" },
  { title: "Expires after seconds", dataIndex: "expiresAfterSeconds" },
  { title: "Revision digest", dataIndex: "revisionDigest", copyable: true },
  { title: "发布时间", dataIndex: "publishedAt", valueType: "dateTime" },
];

export default function EntitlementTemplateDetailPage(): React.ReactElement {
  const { revisionRef } = useParams<{ revisionRef: string }>();
  return <CommerceResourceDetail<AdminEntitlementTemplate> resource="entitlement-templates" id={revisionRef}
    title="Entitlement Template 详情" listPath="/commerce/entitlement-templates"
    readPermission="commerce.entitlement-template.read" columns={columns} />;
}
