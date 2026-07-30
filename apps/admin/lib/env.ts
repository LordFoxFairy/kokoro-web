import { z } from "zod";

// node 侧 env 单一契约：首次请求运行时校验，避免把 runtime secret 变成镜像构建输入。
// 仅 node 运行时导入（auth.ts / email.ts）；edge middleware 另行直读 process.env。
// SMTP 全可选：未配则 email.ts 退回 console。生产是否强制 SMTP 属部署编排关注，不在构建期硬卡。
const schema = z.object({
  AUTH_SECRET: z.string().min(1),
  KOKORO_ADMIN_RPC_URL: z.string().url().refine((value) => value.startsWith("https://")),
  KOKORO_ADMIN_TLS_KEY_FILE: z.string().min(1),
  KOKORO_ADMIN_TLS_CERT_FILE: z.string().min(1),
  KOKORO_ADMIN_TLS_CA_FILE: z.string().min(1),
  KOKORO_ADMIN_TLS_SERVER_NAME: z.string().min(1),
  KOKORO_ADMIN_DELIVERY_KEY_RING_FILE: z.string().min(1),
  KOKORO_ADMIN_WORKLOAD_IDENTITY_REF: z.string().startsWith("spiffe://"),
  KOKORO_ADMIN_AUDIENCE: z.string().min(1),
  KOKORO_ADMIN_ENVIRONMENT: z.string().min(1),
  KOKORO_ADMIN_REGION: z.string().min(1),
  KOKORO_ADMIN_MANAGED_DEVICE_REF: z.string().min(1),
  KOKORO_ADMIN_SITE_ID: z.string().min(1),
  KOKORO_ADMIN_RETURN_INTENT_REF: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/u).default("dashboard"),
  KOKORO_ADMIN_STEP_UP_CALLBACK_REF: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/u).default("step-up"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type AdminWebEnv = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): AdminWebEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`[env] admin-web 配置校验失败：\n${lines}`);
  }
  return parsed.data;
}

export function getEnv(source: Record<string, string | undefined> = process.env): AdminWebEnv {
  return parseEnv(source);
}
