import { z } from "zod";

export const siteSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  key: z.string().nullish(),
});
export type Site = z.infer<typeof siteSchema>;

// /api/me：当前操作员能力面，UI 据此决定可见操作（服务端仍二次强制）。
export const meSchema = z.object({
  email: z.string(),
  roleKey: z.string(),
  permissions: z.array(z.string()),
  scopeSites: z.array(z.string()),
});
export type Me = z.infer<typeof meSchema>;

// 权限 glob：* / 精确 / prefix.*，与网关 permits 一致。
export function permits(permissions: readonly string[], permission: string): boolean {
  return permissions.some(
    (g) => g === "*" || g === permission || (g.endsWith(".*") && permission.startsWith(g.slice(0, -1))),
  );
}
