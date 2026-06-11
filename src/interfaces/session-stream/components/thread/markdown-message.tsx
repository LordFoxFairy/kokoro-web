import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

// 助手消息按 markdown 渲染：react-markdown 构建 React 元素树，默认不启用 rehype-raw，
// 故内嵌的原始 HTML（<script>/<img onerror> 等）被当作文本而非可执行节点——从根上防 XSS。
// remark-gfm 补齐表格/任务列表/删除线/自动链接。仅助手走这里；用户输入保持纯文本。
const MARKDOWN_COMPONENTS: Components = {
  // LLM 生成的链接强制新窗 + noopener/noreferrer/nofollow：不泄露 referrer、不让目标页操作 opener。
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    )
  },
}

type MarkdownMessageProps = {
  content: string
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="kk-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
