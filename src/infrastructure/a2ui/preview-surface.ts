import { MessageProcessor, type A2uiMessage } from "@a2ui/web_core/v0_9"
import { A2uiSurface, basicCatalog } from "@a2ui/react/v0_9"

const PREVIEW_MESSAGES: A2uiMessage[] = [
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

export function createPreviewSurface() {
  const processor = new MessageProcessor([basicCatalog])

  processor.processMessages(PREVIEW_MESSAGES)

  return processor.model.getSurface("artifact-preview")
}

export { A2uiSurface }
