"use client";

import { Alert } from "antd";

import { useT } from "@/i18n/context";
import type { CommandActionResult } from "@/lib/command-result";

import { commandErrorKey } from "./command-error";

export function CommandResult({ result }: Readonly<{
  result: CommandActionResult | null;
}>): React.ReactElement | null {
  const t = useT();
  if (result === null) return null;
  return result.status === "error" ? (
    <Alert
      className="command-result"
      type="error"
      showIcon
      title={`${t("action.error")} · ${t(commandErrorKey(result.kind))}`}
      description={result.requestId.length > 0 ? result.requestId : undefined}
    />
  ) : (
    <Alert
      className="command-result"
      type="success"
      showIcon
      title={t(result.replayed ? "action.replayed" : "action.success")}
    />
  );
}
