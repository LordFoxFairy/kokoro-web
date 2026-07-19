# kokoro-web 生产镜像（Next.js standalone）。多阶段：deps → build → 精简 runtime。
# 服务端 env（KOKORO_SESSION_BASE_URL / KOKORO_WEB_SESSION_SECRET 等）运行时注入,不烘焙。
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
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
