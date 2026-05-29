"use client"

import { A2uiSurface, createPreviewSurface } from "@/infrastructure/a2ui/preview-surface"

export function ArtifactPreview() {
  const previewSurface = createPreviewSurface()

  if (!previewSurface) {
    return <p className="text-sm text-[#6b5b4a]">Waiting for artifact surface.</p>
  }

  return <A2uiSurface surface={previewSurface} />
}
