/**
 * LOCKED @a2ui API signature pattern (discovered via .d.ts reading + implementation inspection):
 *
 * createComponentImplementation(api, RenderComponent)
 *   - api: { name: string, schema: ZodSchema }
 *   - RenderComponent: FC<{ props: ResolvedProps, buildChild: (id, basePath?) => ReactNode, context: ComponentContext }>
 *
 * GenericBinder resolves props before passing to RenderComponent:
 *   - DynamicStringSchema field (e.g. text: { path: "/x" }) → resolved to string
 *   - ChildListSchema field (children: string[]) → resolved to { id, basePath }[] (STRUCTURAL)
 *   - z.string() / z.enum() static fields → passed through as-is
 *
 * Container pattern: use buildChild(id, basePath?) to render child nodes.
 * ChildList component from @a2ui/react handles both string[] and { id, basePath }[] forms.
 *
 * Catalog registration: new Catalog(id, components[])
 * kokoro/chat/v1 components: Thread / Message / ThinkingBlock / ToolCard
 */
import { Catalog } from "@a2ui/web_core/v0_9"
import { messageComponent } from "./components/message"
import { threadComponent } from "./components/thread"
import { thinkingBlockComponent } from "./components/thinking-block"
import { toolCardComponent } from "./components/tool-card"

// kokoro 对话 catalog；createSurface.catalogId 必须等于此 id。
export const KOKORO_CHAT_CATALOG_ID = "kokoro/chat/v1"

export const kokoroChatCatalog = new Catalog(KOKORO_CHAT_CATALOG_ID, [
  threadComponent,
  messageComponent,
  thinkingBlockComponent,
  toolCardComponent,
])
