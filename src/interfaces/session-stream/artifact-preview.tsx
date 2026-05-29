"use client"

import { useMemo, useSyncExternalStore } from "react"

import { A2uiSurface, basicCatalog } from "@a2ui/react/v0_9"
import { MessageProcessor, type A2uiMessage } from "@a2ui/web_core/v0_9"

const previewMessages: A2uiMessage[] = [
  {
    version: "v0.9",
    createSurface: {
      surfaceId: "artifact-preview",
      catalogId: basicCatalog.id,
    },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "artifact-preview",
      components: [
        {
          id: "root",
          component: "Card",
          child: "content",
        },
        {
          id: "content",
          component: "Column",
          children: ["title", "body"],
        },
        {
          id: "title",
          component: "Text",
          text: { path: "/title" },
          variant: "h3",
        },
        {
          id: "body",
          component: "Text",
          text: { path: "/body" },
        },
      ],
    },
  },
  {
    version: "v0.9",
    updateDataModel: {
      surfaceId: "artifact-preview",
      path: "/",
      value: {
        title: "A2UI artifact preview",
        body: "Static v0.9 surface wired for future AGUI + SSE hydration.",
      },
    },
  },
]

const subscribe = () => () => {}

export function ArtifactPreview() {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false)
  const previewSurface = useMemo(() => {
    if (!isClient) {
      return null
    }

    // A2UI 当前在 hydration 边界会触发 snapshot 依赖，所以等客户端快照确认后再创建 surface。
    const processor = new MessageProcessor([basicCatalog])

    processor.processMessages(previewMessages)

    return processor.model.getSurface("artifact-preview")
  }, [isClient])

  if (!isClient) {
    return <p className="kk-copy-muted">Loading artifact preview.</p>
  }

  if (!previewSurface) {
    return <p className="kk-copy-muted">Waiting for artifact surface.</p>
  }

  return <A2uiSurface surface={previewSurface} />
}
