"use client";

import type { ProColumns } from "@ant-design/pro-components";

import { PublishEntitlementTemplateForm } from "@/components/commerce/commerce-publish-forms";
import { CommerceResourceList } from "@/components/commerce/commerce-resource-list";
import { useAdmin } from "@/components/shell/app-shell";
import type { AdminEntitlementTemplate } from "@/lib/commerce-contract";
import { commerceAccessPlan } from "@/lib/commerce-permissions";

const columns: ProColumns<AdminEntitlementTemplate>[] = [
  { title: "Revision ref", dataIndex: "entitlementTemplateRevisionRef", copyable: true, ellipsis: true },
  { title: "Template", dataIndex: "templateRef", ellipsis: true },
  { title: "Label", dataIndex: "safeLabel" },
  { title: "Capability", dataIndex: "capabilityKey" },
  { title: "Revision", dataIndex: "revision", width: 90 },
  { title: "发布时间", dataIndex: "publishedAt", valueType: "dateTime", width: 190 },
];

export default function EntitlementTemplatesPage(): React.ReactElement {
  const { siteId, me } = useAdmin();
  const access = commerceAccessPlan(me?.permissions ?? []).entitlementTemplates;
  return <CommerceResourceList<AdminEntitlementTemplate> resource="entitlement-templates"
    title="Entitlement Templates" description="可复用权益模板的不可变 revision。"
    detailBase="/commerce/entitlement-templates" readPermission="commerce.entitlement-template.read"
    columns={columns} extra={<PublishEntitlementTemplateForm siteId={siteId} enabled={access.publish} />} />;
}
