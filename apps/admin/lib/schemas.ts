import { z } from "zod";

// 仍由 legacy manifest gateway 使用的非 Credit 资源 wire schemas。
export const siteSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  key: z.string().nullish(),
});
export type Site = z.infer<typeof siteSchema>;
export const sitesSchema = z.array(siteSchema);

// /api/action 成功载荷：只关心待审批标记，其余字段无需消费。
export const actionResultSchema = z.object({
  pendingApproval: z.boolean().optional(),
  approvalId: z.string().optional(),
});
export type ActionResult = z.infer<typeof actionResultSchema>;

// 技能上传预览响应（hub UploadPreview）：网关经 /api/action 透传上游 data。
export const skillUploadPreviewSchema = z.object({
  namespace: z.string(),
  candidates: z.array(
    z.object({
      name: z.string(),
      valid: z.boolean(),
      errors: z.array(z.string()),
      description: z.string().nullable(),
      content_hash: z.string().nullable(),
      package_size: z.number(),
      file_count: z.number(),
      files: z.array(z.object({ path: z.string(), size: z.number() })),
      conflicts: z.object({ official: z.boolean(), namespace: z.boolean() }),
    }),
  ),
});
export type SkillUploadPreview = z.infer<typeof skillUploadPreviewSchema>;
export type SkillUploadCandidate = SkillUploadPreview["candidates"][number];

// 技能上传确认响应（hub ConfirmResult[]）：逐项允许 published/unchanged/failed 局部成功。
export const skillUploadConfirmSchema = z.object({
  namespace: z.string(),
  results: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["published", "unchanged", "failed"]),
      revision: z.number().nullable(),
      content_hash: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
export type SkillUploadConfirm = z.infer<typeof skillUploadConfirmSchema>;

// /api/me：当前操作员能力面，UI 据此决定可见操作（服务端仍二次强制）。
export const meSchema = z.object({
  email: z.string(),
  roleKey: z.string(),
  permissions: z.array(z.string()),
  scopeSites: z.array(z.string()),
});
export type Me = z.infer<typeof meSchema>;

// /api/manifests：模块 + 资源 + 动作。shell 拉一次共享，省去每个资源页重复扇出。
export const actionMetaSchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  kind: z.string(),
  requiredPermission: z.string().optional(),
  route: z.string().nullish(),
});
export const moduleManifestSchema = z.object({
  id: z.string(),
  online: z.boolean(),
  manifest: z
    .object({
      resources: z
        .array(
          z.object({
            id: z.string(),
            labelKey: z.string(),
            route: z.string(),
            siteScopeField: z.enum(["siteId", "id"]).nullable(),
            actions: z.array(actionMetaSchema).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});
export const manifestsSchema = z.array(moduleManifestSchema);
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

// 权限 glob：* / 精确 / prefix.*，与网关 permits 一致。
export function permits(permissions: readonly string[], permission: string): boolean {
  return permissions.some(
    (g) => g === "*" || g === permission || (g.endsWith(".*") && permission.startsWith(g.slice(0, -1))),
  );
}
