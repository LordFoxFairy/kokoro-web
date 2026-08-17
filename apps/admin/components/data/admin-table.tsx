"use client";

import { ProTable, type ProColumns } from "@ant-design/pro-table";
import type { GetRowKey } from "antd/es/table/interface";

export type AdminTableProps<RecordType extends Record<string, unknown>> = Readonly<{
  ariaLabel: string;
  columns: readonly ProColumns<RecordType>[];
  data: readonly RecordType[];
  emptyText: React.ReactNode;
  rowKey: string | GetRowKey<RecordType>;
  scrollX?: number;
}>;

export function AdminTable<RecordType extends Record<string, unknown>>({
  ariaLabel,
  columns,
  data,
  emptyText,
  rowKey,
  scrollX,
}: AdminTableProps<RecordType>): React.ReactElement {
  return (
    <div className="data-table" role="region" aria-label={ariaLabel} tabIndex={0}>
      <ProTable<RecordType>
        cardProps={false}
        columns={[...columns]}
        dataSource={[...data]}
        locale={{ emptyText }}
        options={false}
        pagination={false}
        rowKey={rowKey}
        search={false}
        size="small"
        scroll={scrollX === undefined ? undefined : { x: scrollX }}
      />
    </div>
  );
}
