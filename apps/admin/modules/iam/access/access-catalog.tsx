"use client";

import { Button, Descriptions, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter } from "next/navigation";

import { CursorPagination } from "@/components/data/cursor-pagination";
import { StatusTag } from "@/components/data/status-tag";
import { PageState } from "@/components/feedback/page-state";
import { useT } from "@/i18n/context";

import type { AccessPermission, AccessRole, AccessView } from "./schema";
import { accessHref } from "./url";

export function AccessCatalog({ view }: Readonly<{ view: AccessView }>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const roleColumns: ColumnsType<AccessRole> = [
    { title: t("member.role"), dataIndex: "name" },
    { title: t("organization.slug"), dataIndex: "key", className: "technical-value" },
    { title: t("common.description"), dataIndex: "description" },
    { title: t("access.rolePermissions"), dataIndex: "permissionKeys", render: (keys: readonly string[]) => keys.join(", ") },
    { title: t("member.builtIn"), dataIndex: "builtIn", width: 130, render: (value: boolean) => value ? <Tag color="green">{t("member.builtIn")}</Tag> : t("common.none") },
    { title: t("organization.status"), dataIndex: "status", width: 110, render: (status: string) => <StatusTag status={status} /> },
  ];
  const permissionColumns: ColumnsType<AccessPermission> = [
    { title: t("access.permission"), dataIndex: "key", className: "technical-value" },
    { title: t("access.resource"), dataIndex: "resource" },
    { title: t("access.action"), dataIndex: "action" },
    { title: t("common.description"), dataIndex: "description" },
    { title: t("organization.status"), dataIndex: "status", width: 110, render: (status: string) => <StatusTag status={status} /> },
  ];

  return (
    <section className="data-page" aria-labelledby="access-title">
      <header className="page-heading">
        <h1 id="access-title">{t("access.title")}</h1>
        <span>{t("access.description")}</span>
      </header>
      <form className="filter-bar" method="get" action="/access">
        <label className="filter-search">
          <span>{t("organization.search")}</span>
          <input
            type="search"
            name="organizationQuery"
            aria-label={t("organization.search")}
            defaultValue={view.filters.organizationQuery}
          />
        </label>
        <label>
          <span>{t("access.organization")}</span>
          <select name="organizationId" aria-label={t("access.organization")} defaultValue={view.filters.organizationId ?? ""}>
            <option value="">{t("common.none")}</option>
            {view.organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>{organization.name} · {organization.slug}</option>
            ))}
          </select>
        </label>
        <label className="filter-search">
          <span>{t("access.userSearch")}</span>
          <input
            type="search"
            name="userQuery"
            aria-label={t("access.userSearch")}
            defaultValue={view.filters.userQuery}
          />
        </label>
        <label>
          <span>{t("access.user")}</span>
          <select name="userId" aria-label={t("access.user")} defaultValue={view.filters.userId ?? ""} required>
            <option value="">{t("common.none")}</option>
            {view.users.map((user) => (
              <option key={user.id} value={user.id}>{user.name} · {user.email}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("access.permission")}</span>
          <select name="permissionKey" aria-label={t("access.permission")} defaultValue={view.filters.permissionKey ?? ""}>
            <option value="">{t("common.none")}</option>
            {view.permissions.filter((permission) => permission.status === "active").map((permission) => (
              <option key={permission.key} value={permission.key}>{permission.key}</option>
            ))}
          </select>
        </label>
        <label className="filter-search">
          <span>{t("access.resourceRef")}</span>
          <input type="text" name="resourceRef" aria-label={t("access.resourceRef")} defaultValue={view.filters.resourceRef ?? ""} />
        </label>
        <input type="hidden" name="organizationLimit" value={view.filters.organizationLimit} />
        <Button htmlType="submit" type="primary">{t("access.evaluate")}</Button>
      </form>
      <CursorPagination
        canGoBack={view.filters.organizationCursor !== null}
        nextCursor={view.nextOrganizationCursor}
        onPrevious={() => router.back()}
        onNext={(cursor) => router.push(accessHref(view.filters, cursor))}
      />
      {view.decision === null ? null : (
        <section className="decision-section" aria-labelledby="access-decision-title">
          <div className="section-heading">
            <h2 id="access-decision-title">{t("access.decision")}</h2>
            <Tag color={view.decision.allowed ? "green" : "red"}>
              {t(view.decision.allowed ? "access.allowed" : "access.denied")}
            </Tag>
          </div>
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
            <Descriptions.Item label={t("access.reason")}>{view.decision.reasonCode}</Descriptions.Item>
            <Descriptions.Item label={t("access.userId")}><code>{view.decision.userId}</code></Descriptions.Item>
            <Descriptions.Item label={t("access.organization")}><code>{view.decision.organizationId}</code></Descriptions.Item>
            <Descriptions.Item label={t("member.role")}>{view.decision.roleKeys.join(", ") || t("common.none")}</Descriptions.Item>
            <Descriptions.Item label={t("access.authorizationVersion")}><code>{view.decision.authorizationVersion}</code></Descriptions.Item>
            <Descriptions.Item label={t("access.evaluatedAt")}><time dateTime={view.decision.evaluatedAt}>{view.decision.evaluatedAt}</time></Descriptions.Item>
          </Descriptions>
        </section>
      )}
      <section className="catalog-section" aria-labelledby="access-role-catalog-title">
        <div className="section-heading"><h2 id="access-role-catalog-title">{t("access.roleCatalog")}</h2></div>
        {view.filters.organizationId === null ? <PageState kind="empty" /> : (
          <div className="data-table" role="region" aria-label={t("access.roleCatalog")} tabIndex={0}>
            <Table<AccessRole> rowKey="key" columns={roleColumns} dataSource={[...view.roles]} pagination={false} scroll={{ x: 820 }} />
          </div>
        )}
      </section>
      <section className="catalog-section" aria-labelledby="access-permission-catalog-title">
        <div className="section-heading"><h2 id="access-permission-catalog-title">{t("access.permissionCatalog")}</h2></div>
        <div className="data-table" role="region" aria-label={t("access.permissionCatalog")} tabIndex={0}>
          <Table<AccessPermission> rowKey="key" columns={permissionColumns} dataSource={[...view.permissions]} pagination={false} scroll={{ x: 920 }} />
        </div>
      </section>
    </section>
  );
}
