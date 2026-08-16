"use client";

import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Space } from "antd";

import { useT } from "@/i18n/context";

export type CursorPaginationProps = Readonly<{
  canGoBack: boolean;
  nextCursor: string | null;
  busy?: boolean;
  onPrevious(): void;
  onNext(cursor: string): void;
}>;

export function CursorPagination({
  canGoBack,
  nextCursor,
  busy = false,
  onPrevious,
  onNext,
}: CursorPaginationProps): React.ReactElement {
  const t = useT();

  return (
    <nav className="cursor-pagination" aria-label={`${t("pagination.previous")} / ${t("pagination.next")}`}>
      <Space>
        <Button aria-label={t("pagination.previous")} icon={<LeftOutlined />} disabled={!canGoBack || busy} onClick={onPrevious}>
          {t("pagination.previous")}
        </Button>
        <Button
          icon={<RightOutlined />}
          iconPlacement="end"
          aria-label={t("pagination.next")}
          disabled={nextCursor === null || busy}
          onClick={() => nextCursor !== null && onNext(nextCursor)}
        >
          {t("pagination.next")}
        </Button>
      </Space>
    </nav>
  );
}
