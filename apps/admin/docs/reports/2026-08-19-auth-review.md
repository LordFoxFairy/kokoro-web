# Admin Auth.js 接入审查报告

## 结论

| 字段 | 结果 |
|---|---|
| 批次 | Auth.js 登录、Session、保护、回跳与退出 |
| 分支 | `codex/admin-web-iam-control-plane` |
| 批次状态 | `AUTOMATION_PASS` / `VISIBLE_FOCUS_RECHECK_PENDING` |
| Admin 整体状态 | `NOT_READY` |

本批次接入 Auth.js `5.0.0-beta.32`、Next 16 `proxy.ts`、App Router Route Handler、
server-only env 读取和 JWT Session。生产 Credentials provider 保持关闭；当前已发布 IAM v1
没有密码登录 RPC，因此本批次不宣称生产登录或真实 IAM 验收完成。

## 实现边界

- `src/auth.ts` 只从 `src/lib/server/env.ts` 读取运行时环境，IAM 地址、Auth secret 和开发凭据
  不进入浏览器 bundle。
- development/test 只有显式完整 `AUTH_DEV_*` 环境且 `AUTH_SECRET` 有效时注册独立 Credentials
  provider；production 始终注册零 Credentials provider。
- Auth.js Session 经过严格白名单映射为既有 `SessionView`；过期、未知 claim、主体不完整都按
  未认证处理。
- `authorized` 对匿名 Console 请求返回同源 `NextResponse`，callback 只携带已登记 Admin path，
  不信任代理 host；layout 再调用 `auth()` 做服务端二次检查。
- 登出使用 Auth.js server action，清除 JWT Cookie 后回到 `/login`。

## 自动化证据

| 门禁 | 结果 |
|---|---|
| Auth domain/component tests | 通过，当前批次覆盖配置、凭据、Session、回跳、route access、登录表单与 Skip focus |
| TypeScript | 通过 |
| Production build | 通过，包含 `ƒ /api/auth/[...nextauth]` 与 `ƒ Proxy (Middleware)` |
| 请求保护 | `GET /users` 匿名返回 `307 /login?callbackUrl=%2Fusers` |
| Provider 清单 | `GET /api/auth/providers` 仅返回 `kokoro-dev-credentials`（development fixture env） |
| Session | Auth callback 后 `GET /api/auth/session` 返回 `usr_ada`、显示名、邮箱和能力投影 |
| Logout | 可见菜单退出后回到 `/login?callbackUrl=%2F` |

## 可见证据

证据根目录：`apps/admin/docs/reports/evidence/2026-08-19-ui-review/`

- `auth-round1-desktop-dashboard.png`：登录后 Dashboard，`1440x1000`。
- `auth-round1-login.png`：退出后的登录页。
- `auth-round1-mobile-login.png`：`390x844` 登录页。
- `auth-round1-mobile-users.png`：安全回跳到用户列表，`390x844`，移动行详情按钮可见。
- `auth-round1-metrics.json`：第一轮 desktop/mobile 主 landmark、溢出和主体摘要指标。
- `auth-round2-users-desktop.jpg`：第二轮桌面复核，验证 callback 回跳与用户摘要。
- `auth-round2-metrics.json`：第二轮 `main-content` 与 `scroll` 指标（desktop 已记录；mobile 待补）。

## 待办与限制

- Skip Link 的 Enter/Space 键盘逻辑已补齐并补充单测；当前仍保留可见复核待定状态（上一轮记录 Enter
  触发后 active 为 `BODY`，需在新会话复测确认 `#main-content` 焦点）。
- 当前 development provider 只服务本地 fixture；生产密码认证必须等待版本化 IAM 认证契约。
- 用户、组织、Site、角色、权限树、会话和审计 mutations 及 generated ConnectRPC 尚未发布，继续
  保持 `NOT_READY`，不得使用 fixture 冒充真实契约。
