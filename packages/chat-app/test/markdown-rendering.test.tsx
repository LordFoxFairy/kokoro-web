import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MarkdownText } from "../src/chat-product.js"

describe("Chat Markdown rendering", () => {
  it("uses grammar highlighting and exposes a block-scoped copy control", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text={"```typescript\nconst ready: boolean = true\n```"} />,
    )

    expect(html).toContain("hljs-keyword")
    expect(html).toContain("data-language=\"typescript\"")
    expect(html).toContain(">Copy<")
  })
})
