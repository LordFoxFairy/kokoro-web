# @kokoro/web-user 生产镜像（Next.js standalone,pnpm monorepo）。
# 构建上下文 = kokoro-web workspace 根（需 pnpm-workspace.yaml + packages/*）。
# 过滤安装只取 web-user 子树（--filter ...）。
# 服务端 env（KOKORO_SESSION_BASE_URL / KOKORO_WEB_SESSION_SECRET 等）运行时注入,不烘焙。
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# pnpm 版本须与本地一致（11.2.2）：pnpm-workspace.yaml 的 allowBuilds 仅新版识别。
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
ENV npm_config_fetch_retries=6 \
    npm_config_fetch_retry_mintimeout=10000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_network_concurrency=4
# workspace 清单 + 锁 + .npmrc(node-linker=isolated)先拷,供过滤安装。全员 package.json 满足
# frozen 一致性,但 --filter @kokoro/web-user... 只装 user 及其依赖（不装 admin）。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/user/package.json ./apps/user/
COPY apps/admin/package.json ./apps/admin/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/i18n/package.json ./packages/i18n/
RUN pnpm install --frozen-lockfile --filter @kokoro/web-user...

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
# 带 deps 阶段的全部 node_modules(过滤安装,各层级);再叠源码(.dockerignore 排除 node_modules,不覆盖)。
COPY --from=deps /app ./
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 关 pnpm11 运行前 deps 校验：deps 阶段是 --filter 过滤安装（未装 admin），全量校验会误判不一致。
ENV pnpm_config_verify_deps_before_run=false
# standalone 产物落 apps/user/.next/standalone（monorepo 布局：内含 node_modules + apps/user/server.js）。
RUN pnpm --filter @kokoro/web-user build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# 容器内须监听 0.0.0.0（standalone server.js 默认 localhost）。
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN useradd --system --uid 1001 kokoro
# monorepo standalone 布局：standalone 根含 node_modules 与 apps/user/server.js;static/public 按 app 路径补。
COPY --from=build --chown=kokoro:kokoro /app/apps/user/.next/standalone ./
COPY --from=build --chown=kokoro:kokoro /app/apps/user/.next/static ./apps/user/.next/static
COPY --from=build --chown=kokoro:kokoro /app/apps/user/public ./apps/user/public
USER kokoro
EXPOSE 3000
CMD ["node", "apps/user/server.js"]
