"use client";

import { Tag } from "antd";

import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/messages";

const statuses = {
  active: { color: "success", label: "status.active" },
  suspended: { color: "warning", label: "status.suspended" },
  deleted: { color: "default", label: "status.deleted" },
  revoked: { color: "error", label: "status.revoked" },
  expired: { color: "default", label: "status.expired" },
  retired: { color: "default", label: "status.retired" },
} as const satisfies Record<string, Readonly<{ color: string; label: MessageKey }>>;

export type KnownStatus = keyof typeof statuses;

export function StatusTag({ status }: Readonly<{ status: string }>): React.ReactElement {
  const t = useT();
  const config = status in statuses ? statuses[status as KnownStatus] : { color: "default", label: "status.unknown" as const };
  return <Tag color={config.color}>{t(config.label)}</Tag>;
}
