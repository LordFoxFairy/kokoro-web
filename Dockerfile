# kokoro-web 生产镜像（Next.js standalone）。多阶段：deps → build → 精简 runtime。
# 服务端 env（KOKORO_SESSION_BASE_URL / KOKORO_WEB_SESSION_SECRET 等）运行时注入,不烘焙。
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# pnpm 版本须与本地一致（11.2.2）：pnpm-workspace.yaml 里 allowBuilds 允许清单仅新版识别,
# 否则 sharp/unrs-resolver 原生构建被忽略 → ERR_PNPM_IGNORED_BUILDS → frozen 装配 exit 1。
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
# pnpm 网络韧性：降并发 + 多重试 + 长超时（flaky 网络/CI 抗 RST）。
ENV npm_config_fetch_retries=6 \
    npm_config_fetch_retry_mintimeout=10000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_network_concurrency=4
# pnpm-workspace.yaml 携带 allowBuilds（批准 sharp/unrs-resolver 原生构建脚本）——必须与 manifest 同拷,
# 否则容器内允许清单缺失,原生构建被忽略致装配失败。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 遥测关；standalone 产物在 .next/standalone。
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# 容器内须监听 0.0.0.0（standalone server.js 默认 localhost，容器外不可达）。
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# 非 root 运行。
RUN useradd --system --uid 1001 kokoro
COPY --from=build --chown=kokoro:kokoro /app/.next/standalone ./
COPY --from=build --chown=kokoro:kokoro /app/.next/static ./.next/static
COPY --from=build --chown=kokoro:kokoro /app/public ./public
USER kokoro
EXPOSE 3000
CMD ["node", "server.js"]
