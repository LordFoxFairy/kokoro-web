"use client";

import { QueryFilter } from "@ant-design/pro-form";

export type AdminQueryFilterProps<Values extends Record<string, unknown>> = Readonly<{
  initialValues: Values;
  searchText: string;
  resetText: string;
  ariaLabel: string;
  children: React.ReactNode;
  onSubmit(values: Values): void;
  onReset(): void;
}>;

export function AdminQueryFilter<Values extends Record<string, unknown>>({
  initialValues,
  searchText,
  resetText,
  ariaLabel,
  children,
  onSubmit,
  onReset,
}: AdminQueryFilterProps<Values>): React.ReactElement {
  return (
    <section className="admin-query-filter" aria-label={ariaLabel}>
      <QueryFilter<Values>
        initialValues={initialValues}
        defaultCollapsed={false}
        labelWidth="auto"
        preserve={false}
        resetText={resetText}
        searchText={searchText}
        span={{ xs: 24, sm: 12, md: 8, lg: 8, xl: 6, xxl: 6 }}
        onFinish={async (values) => {
          onSubmit(values);
          return true;
        }}
        onReset={onReset}
      >
        {children}
      </QueryFilter>
    </section>
  );
}
