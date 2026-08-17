"use client";

import { PageContainer } from "@ant-design/pro-layout";

export type AdminPageProps = Readonly<{
  titleId: string;
  title: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}>;

export function AdminPage({
  titleId,
  title,
  description,
  extra,
  children,
}: AdminPageProps): React.ReactElement {
  return (
    <PageContainer
      className="admin-page"
      breadcrumbRender={false}
      title={<h1 id={titleId}>{title}</h1>}
      content={description}
      extra={extra}
    >
      <section className="admin-page-content" aria-labelledby={titleId}>
        {children}
      </section>
    </PageContainer>
  );
}
