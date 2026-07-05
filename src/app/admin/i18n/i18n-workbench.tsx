"use client"

import { useMemo, useState } from "react"
import {
  App as AntApp,
  Alert,
  Button,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Segmented,
  Select,
  Statistic,
  Table,
  Tag,
  type TableProps,
} from "antd"

import styles from "./i18n-workbench.module.css"

type TranslationStatus = "ready" | "ambiguous"

export interface I18nWorkbenchPayload {
  readonly locale: string
  readonly locales: readonly string[]
  readonly entries: readonly I18nEntry[]
  readonly filters: {
    readonly contexts: readonly string[]
    readonly sources: readonly string[]
  }
  readonly summary: {
    readonly total: number
    readonly ready: number
    readonly ambiguous: number
  }
  readonly loadError?: string
}

export interface I18nEntry {
  readonly key: string
  readonly sourceText: string
  readonly context?: string
  readonly zhCN: string
  readonly enUS: string
  readonly status: TranslationStatus
  readonly source: string
}

interface I18nWorkbenchProps {
  readonly payload: I18nWorkbenchPayload
  readonly onLocaleChange?: (locale: string) => void
}

const languageNames: Record<string, string> = {
  "zh-CN": "中文（简体）",
  "en-US": "English",
}

const statusOptions: Array<{ label: string; value: TranslationStatus | "all" }> = [
  { label: "全部状态", value: "all" },
  { label: "已配置", value: "ready" },
  { label: "重复原文", value: "ambiguous" },
]

export function I18nWorkbench({ payload, onLocaleChange }: I18nWorkbenchProps) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<TranslationStatus | "all">("all")
  const [source, setSource] = useState("all")
  const [selectedEntry, setSelectedEntry] = useState<I18nEntry | null>(null)

  const localeOptions = useMemo(
    () =>
      payload.locales.map((locale) => ({
        label: languageLabel(locale),
        value: locale,
      })),
    [payload.locales],
  )

  const sourceOptions = useMemo(
    () => [
      { label: "全部归属", value: "all" },
      ...payload.filters.sources.map((candidate) => ({
        label: sourceLabel(candidate),
        value: candidate,
      })),
    ],
    [payload.filters.sources],
  )

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return payload.entries.filter((entry) => {
      const searchable = [entry.sourceText, entry.zhCN, entry.enUS, sourceLabel(entry.source)]
        .join(" ")
        .toLowerCase()
      const matchesQuery = normalizedQuery.length === 0 || searchable.includes(normalizedQuery)
      const matchesStatus = status === "all" || entry.status === status
      const matchesSource = source === "all" || entry.source === source

      return matchesQuery && matchesStatus && matchesSource
    })
  }, [payload.entries, query, source, status])

  const changeLocale = (locale: string) => {
    if (onLocaleChange) {
      onLocaleChange(locale)
      return
    }

    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set("locale", locale)
    window.location.assign(nextUrl.toString())
  }

  const columns: TableProps<I18nEntry>["columns"] = [
    {
      title: "原文 Key",
      dataIndex: "sourceText",
      key: "sourceText",
      width: 180,
      render: (value: string) => <span className={styles.sourceKey}>{value}</span>,
    },
    {
      title: "中文（简体）",
      dataIndex: "zhCN",
      key: "zhCN",
      width: 180,
    },
    {
      title: "English",
      dataIndex: "enUS",
      key: "enUS",
      width: 230,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (value: TranslationStatus) => <StatusTag status={value} />,
    },
    {
      title: "归属",
      dataIndex: "source",
      key: "source",
      width: 90,
      render: (value: string) => <span className={styles.cellMuted}>{sourceLabel(value)}</span>,
    },
    {
      title: "操作",
      key: "actions",
      width: 72,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => setSelectedEntry(record)}
          aria-label={`查看 ${record.sourceText}`}
        >
          查看
        </Button>
      ),
    },
  ]

  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 4,
          colorPrimary: "#1677ff",
          colorSuccess: "#16a34a",
          colorWarning: "#d97706",
          fontFamily:
            'var(--font-geist-sans), Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Table: {
            cellPaddingBlock: 10,
            cellPaddingInline: 12,
            headerBg: "#f8fafc",
            headerColor: "#4b5563",
          },
        },
      }}
    >
      <AntApp>
        <main className={styles.page}>
          <div className={styles.shell}>
            <section className={styles.mainPanel}>
              <div className={styles.header}>
                <div className={styles.brand}>
                  <h1>i18n 文案维护</h1>
                  <p>按原文维护翻译，面向运营日常处理。</p>
                </div>

                <div className={styles.summary} aria-label="文案概览">
                  <div className={styles.summaryItem}>
                    <Statistic title="文案总数" value={payload.summary.total} />
                  </div>
                  <div className={styles.summaryItem}>
                    <Statistic title="已配置" value={payload.summary.ready} />
                  </div>
                  <div className={styles.summaryItem}>
                    <Statistic title="重复原文" value={payload.summary.ambiguous} />
                  </div>
                </div>
              </div>

              {payload.loadError ? (
                <Alert
                  type="warning"
                  showIcon
                  message="i18n 数据暂不可用"
                  description={payload.loadError}
                />
              ) : null}

              <div className={styles.toolbar} role="region" aria-label="文案筛选">
                <Input.Search
                  allowClear
                  aria-label="搜索原文或译文"
                  placeholder="搜索原文或译文"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <label className={styles.filterField}>
                  <span className={styles.fieldLabel}>目标语言</span>
                  <Select
                    aria-label="目标语言"
                    value={payload.locale}
                    options={localeOptions}
                    onChange={changeLocale}
                  />
                </label>
                <label className={styles.filterField}>
                  <span className={styles.fieldLabel}>状态</span>
                  <Segmented<TranslationStatus | "all">
                    aria-label="状态"
                    value={status}
                    options={statusOptions}
                    onChange={setStatus}
                  />
                </label>
                <label className={styles.filterField}>
                  <span className={styles.fieldLabel}>归属</span>
                  <Select
                    aria-label="归属"
                    value={source}
                    options={sourceOptions}
                    onChange={setSource}
                  />
                </label>
              </div>

              <div className={styles.tableHeader}>
                <h2 className={styles.tableTitle}>文案表</h2>
                <span className={styles.resultCount}>{filteredEntries.length} 条结果</span>
              </div>

              <Table
                rowKey={(record) => `${record.sourceText}:${record.zhCN}:${record.enUS}:${record.source}`}
                columns={columns}
                dataSource={[...filteredEntries]}
                pagination={{
                  pageSize: 20,
                  pageSizeOptions: [20, 50, 100],
                  showSizeChanger: true,
                  showTotal: (total, range) => `${range[0]}-${range[1]} / ${total} 条`,
                }}
                scroll={{ x: 852 }}
                locale={{
                  emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的文案" />,
                }}
              />
            </section>
          </div>

          <Drawer
            title="翻译详情"
            open={selectedEntry !== null}
            onClose={() => setSelectedEntry(null)}
            size={440}
            aria-label="翻译详情"
            getContainer={false}
          >
            {selectedEntry ? (
              <div className={styles.drawerStack}>
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="原文 Key">{selectedEntry.sourceText}</Descriptions.Item>
                  <Descriptions.Item label="中文（简体）">{selectedEntry.zhCN}</Descriptions.Item>
                  <Descriptions.Item label="English">{selectedEntry.enUS}</Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <StatusTag status={selectedEntry.status} />
                  </Descriptions.Item>
                  <Descriptions.Item label="归属">{sourceLabel(selectedEntry.source)}</Descriptions.Item>
                </Descriptions>
              </div>
            ) : null}
          </Drawer>
        </main>
      </AntApp>
    </ConfigProvider>
  )
}

function StatusTag({ status }: { readonly status: TranslationStatus }) {
  if (status === "ambiguous") {
    return <Tag color="gold">重复原文</Tag>
  }

  return <Tag color="green">已配置</Tag>
}

function languageLabel(locale: string): string {
  return languageNames[locale] ?? locale
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    platform: "平台",
    site: "站点",
    user: "用户",
    model: "模型",
    credit: "积分",
    payment: "支付",
  }

  return labels[source] ?? source
}
