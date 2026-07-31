const CODE_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  bash: "sh",
  css: "css",
  html: "html",
  javascript: "js",
  json: "json",
  jsx: "jsx",
  markdown: "md",
  python: "py",
  shell: "sh",
  sql: "sql",
  text: "txt",
  tsx: "tsx",
  typescript: "ts",
  xml: "xml",
  yaml: "yaml",
  yml: "yml",
})

type CodeDownloadDocument = Readonly<{
  createElement(tag: "a"): {
    href: string
    download: string
    click(): void
  }
}>

type CodeDownloadUrl = Readonly<{
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}>

export function downloadCodeText(input: Readonly<{
  text: string
  language: string | null
  document: CodeDownloadDocument
  url: CodeDownloadUrl
}>): void {
  const normalizedLanguage = input.language?.toLowerCase() ?? "text"
  const extension = CODE_EXTENSIONS[normalizedLanguage] ?? "txt"
  const objectUrl = input.url.createObjectURL(new Blob([input.text], { type: "text/plain;charset=utf-8" }))
  try {
    const anchor = input.document.createElement("a")
    anchor.href = objectUrl
    anchor.download = `code-snippet.${extension}`
    anchor.click()
  } finally {
    input.url.revokeObjectURL(objectUrl)
  }
}
