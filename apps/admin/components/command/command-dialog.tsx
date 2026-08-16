"use client";

import { Alert, Button, Input, Modal } from "antd";
import { useId, useState } from "react";

import { commandErrorKey } from "@/components/feedback/command-error";
import { useT } from "@/i18n/context";
import type { CommandActionResult } from "@/lib/command-result";

export type CommandDialogProps = Readonly<{
  open: boolean;
  title: string;
  entityLabel: string;
  danger?: boolean;
  result?: CommandActionResult | null;
  onCancel(): void;
  onConfirm(reason: string): Promise<void>;
}>;

export function CommandDialog({
  open,
  title,
  entityLabel,
  danger = false,
  result = null,
  onCancel,
  onConfirm,
}: CommandDialogProps): React.ReactElement {
  const t = useT();
  const reasonId = useId();
  const errorId = useId();
  const [reason, setReason] = useState("");
  const [lockedReason, setLockedReason] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm(): Promise<void> {
    const normalized = lockedReason ?? reason.trim();
    if (normalized.length === 0) {
      setError(true);
      return;
    }
    setError(false);
    setLockedReason(normalized);
    setPending(true);
    try {
      await onConfirm(normalized);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      destroyOnHidden
      width={480}
      footer={[
        <Button key="cancel" aria-label={t("command.cancel")} onClick={onCancel} disabled={pending}>
          {t("command.cancel")}
        </Button>,
        <Button
          key="confirm"
          aria-label={t("command.confirm")}
          type="primary"
          danger={danger}
          loading={pending}
          onClick={confirm}
        >
          {t("command.confirm")}
        </Button>,
      ]}
    >
      <dl className="command-summary">
        <dt>{t("command.entity")}</dt>
        <dd>{entityLabel}</dd>
      </dl>
      <div className="command-field">
        <label htmlFor={reasonId}>{t("command.reason")}</label>
        <Input.TextArea
          id={reasonId}
          value={reason}
          disabled={lockedReason !== null}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("command.reasonPlaceholder")}
          maxLength={500}
          rows={3}
          status={error ? "error" : undefined}
          aria-invalid={error}
          aria-describedby={error ? errorId : undefined}
        />
        {error ? <span id={errorId} className="field-error" role="alert">{t("command.reasonRequired")}</span> : null}
      </div>
      {result?.status === "error" ? (
        <Alert
          className="command-result"
          type="error"
          showIcon
          title={`${t("action.error")} · ${t(commandErrorKey(result.kind))}`}
          description={result.requestId.length > 0 ? result.requestId : undefined}
        />
      ) : null}
    </Modal>
  );
}
