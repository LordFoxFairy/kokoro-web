"use client";

import { ProDescriptions } from "@ant-design/pro-descriptions";
import { ProFormSelect, ProFormText } from "@ant-design/pro-form";
import type { ProColumns } from "@ant-design/pro-table";
import { Tabs, Tag, Tree } from "antd";
import { useRouter } from "next/navigation";

import { AdminTable } from "@/components/data/admin-table";
import { CursorPagination } from "@/components/data/cursor-pagination";
import { StatusTag } from "@/components/data/status-tag";
import { PageState } from "@/components/feedback/page-state";
import { AdminQueryFilter } from "@/components/forms/admin-query-filter";
import { AdminPage } from "@/components/platform/admin-page";
import { useT } from "@/i18n/context";

import type { AccessFilters, AccessPermission, AccessRole, AccessView } from "./schema";
import { accessHref } from "./url";

export function AccessCatalog({ view }: Readonly<{ view: AccessView }>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const grantedPermissionKeys = new Set(view.roles.flatMap((role) => role.permissionKeys));
  const permissionTree = [...Map.groupBy(view.permissions, (permission) => permission.resource).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resource, permissions]) => ({
      key: `resource:${resource}`,
      title: resource,
      children: permissions
        .toSorted((left, right) => left.action.localeCompare(right.action))
        .map((permission) => ({
          key: permission.key,
          title: (
            <span className="permission-tree-action">
              <code>{permission.action}</code>
              {grantedPermissionKeys.has(permission.key) ? <Tag color="blue">{t("access.granted")}</Tag> : null}
            </span>
          ),
        })),
    }));
  const roleColumns: ProColumns<AccessRole>[] = [
    { title: t("member.role"), dataIndex: "name" },
    { title: t("organization.slug"), dataIndex: "key", className: "technical-value" },
    { title: t("common.description"), dataIndex: "description" },
    { title: t("access.rolePermissions"), dataIndex: "permissionKeys", render: (_, role) => role.permissionKeys.join(", ") },
    { title: t("member.builtIn"), dataIndex: "builtIn", width: 130, render: (_, role) => role.builtIn ? <Tag color="green">{t("member.builtIn")}</Tag> : t("common.none") },
    { title: t("organization.status"), dataIndex: "status", width: 110, render: (_, role) => <StatusTag status={role.status} /> },
  ];
  const permissionColumns: ProColumns<AccessPermission>[] = [
    { title: t("access.permission"), dataIndex: "key", className: "technical-value" },
    { title: t("access.resource"), dataIndex: "resource" },
    { title: t("access.action"), dataIndex: "action" },
    { title: t("common.description"), dataIndex: "description" },
    { title: t("organization.status"), dataIndex: "status", width: 110, render: (_, permission) => <StatusTag status={permission.status} /> },
  ];
  const initialFilters = {
    organizationQuery: view.filters.organizationQuery,
    organizationId: view.filters.organizationId ?? "",
    userQuery: view.filters.userQuery,
    userId: view.filters.userId ?? "",
    permissionKey: view.filters.permissionKey ?? "",
    resourceRef: view.filters.resourceRef ?? "",
  };

  function navigateWithFilters(values: typeof initialFilters): void {
    const filters: AccessFilters = {
      ...view.filters,
      organizationQuery: values.organizationQuery?.trim() ?? "",
      organizationId: blankToNull(values.organizationId),
      organizationCursor: null,
      userQuery: values.userQuery?.trim() ?? "",
      userId: blankToNull(values.userId),
      permissionKey: blankToNull(values.permissionKey),
      resourceRef: blankToNull(values.resourceRef),
    };
    router.push(accessHref(filters));
  }

  return (
    <AdminPage titleId="access-title" title={t("access.title")} description={t("access.description")}>
      <Tabs
        className="admin-detail-tabs"
        defaultActiveKey="inspector"
        items={[
          {
            key: "inspector",
            label: t("access.evaluate"),
            children: (
              <div className="admin-tab-stack">
                <AdminQueryFilter
                  ariaLabel={t("access.evaluate")}
                  initialValues={initialFilters}
                  searchText={t("access.evaluate")}
                  resetText={t("common.reset")}
                  onSubmit={navigateWithFilters}
                  onReset={() => navigateWithFilters({
                    organizationQuery: "",
                    organizationId: "",
                    userQuery: "",
                    userId: "",
                    permissionKey: "",
                    resourceRef: "",
                  })}
                >
                  <ProFormText
                    name="organizationQuery"
                    label={t("organization.search")}
                    fieldProps={{ type: "search", "aria-label": t("organization.search") }}
                  />
                  <ProFormSelect
                    name="organizationId"
                    label={t("access.organization")}
                    fieldProps={{
                      "aria-label": t("access.organization"),
                      "aria-valuetext": view.filters.organizationId ?? "",
                    }}
                    options={[
                      { value: "", label: t("common.none") },
                      ...view.organizations.map((organization) => ({
                        value: organization.id,
                        label: `${organization.name} · ${organization.slug}`,
                      })),
                    ]}
                  />
                  <ProFormText
                    name="userQuery"
                    label={t("access.userSearch")}
                    fieldProps={{ type: "search", "aria-label": t("access.userSearch") }}
                  />
                  <ProFormSelect
                    name="userId"
                    label={t("access.user")}
                    rules={[{ required: true }]}
                    fieldProps={{
                      "aria-label": t("access.user"),
                      "aria-valuetext": view.filters.userId ?? "",
                    }}
                    options={[
                      { value: "", label: t("common.none") },
                      ...view.users.map((user) => ({ value: user.id, label: `${user.name} · ${user.email}` })),
                    ]}
                  />
                  <ProFormSelect
                    name="permissionKey"
                    label={t("access.permission")}
                    fieldProps={{
                      "aria-label": t("access.permission"),
                      "aria-valuetext": view.filters.permissionKey ?? "",
                    }}
                    options={[
                      { value: "", label: t("common.none") },
                      ...view.permissions
                        .filter((permission) => permission.status === "active")
                        .map((permission) => ({ value: permission.key, label: permission.key })),
                    ]}
                  />
                  <ProFormText
                    name="resourceRef"
                    label={t("access.resourceRef")}
                    fieldProps={{ "aria-label": t("access.resourceRef") }}
                  />
                </AdminQueryFilter>
                <CursorPagination
                  canGoBack={view.filters.organizationCursor !== null}
                  nextCursor={view.nextOrganizationCursor}
                  onPrevious={() => router.back()}
                  onNext={(cursor) => router.push(accessHref(view.filters, cursor))}
                />
                {view.decision === null ? <PageState kind="empty" /> : (
                  <section className="decision-section" aria-labelledby="access-decision-title">
                    <div className="section-heading">
                      <h2 id="access-decision-title">{t("access.decision")}</h2>
                      <Tag color={view.decision.allowed ? "green" : "red"}>
                        {t(view.decision.allowed ? "access.allowed" : "access.denied")}
                      </Tag>
                    </div>
                    <ProDescriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
                      <ProDescriptions.Item label={t("access.reason")}>{view.decision.reasonCode}</ProDescriptions.Item>
                      <ProDescriptions.Item label={t("access.userId")}><code>{view.decision.userId}</code></ProDescriptions.Item>
                      <ProDescriptions.Item label={t("access.organization")}><code>{view.decision.organizationId}</code></ProDescriptions.Item>
                      <ProDescriptions.Item label={t("member.role")}>{view.decision.roleKeys.join(", ") || t("common.none")}</ProDescriptions.Item>
                      <ProDescriptions.Item label={t("access.authorizationVersion")}><code>{view.decision.authorizationVersion}</code></ProDescriptions.Item>
                      <ProDescriptions.Item label={t("access.evaluatedAt")}><time dateTime={view.decision.evaluatedAt}>{view.decision.evaluatedAt}</time></ProDescriptions.Item>
                    </ProDescriptions>
                  </section>
                )}
              </div>
            ),
          },
          {
            key: "roles",
            label: t("access.roleCatalog"),
            children: view.filters.organizationId === null ? <PageState kind="empty" /> : (
              <AdminTable<AccessRole>
                ariaLabel={t("access.roleCatalog")}
                columns={roleColumns}
                data={view.roles}
                emptyText={<PageState kind="empty" />}
                rowKey="key"
                scrollX={820}
              />
            ),
          },
          {
            key: "permissions",
            label: t("access.permissionCatalog"),
            children: (
              <div className="access-permission-workspace">
                <Tree
                  aria-label={t("access.permissionTree")}
                  defaultExpandAll
                  selectable={false}
                  treeData={permissionTree}
                />
                <AdminTable<AccessPermission>
                  ariaLabel={t("access.permissionCatalog")}
                  columns={permissionColumns}
                  data={view.permissions}
                  emptyText={<PageState kind="empty" />}
                  rowKey="key"
                  scrollX={920}
                />
              </div>
            ),
          },
        ]}
      />
    </AdminPage>
  );
}

function blankToNull(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length === 0 ? null : normalized;
}
