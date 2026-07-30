export type ComposerAttachmentReadiness = Readonly<{
  status: "uploading" | "ready" | "failed"
  attachment: unknown | null
}>

export function hasSubmittableComposerContent(
  text: string,
  attachments: readonly ComposerAttachmentReadiness[],
): boolean {
  return text.trim().length > 0 || attachments.some(
    ({ status, attachment }) => status === "ready" && attachment !== null,
  )
}
