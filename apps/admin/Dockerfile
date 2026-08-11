FROM node:24.13.0-alpine3.23@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e AS dependencies
WORKDIR /workspace
RUN npm install --global pnpm@11.2.2
COPY . .
RUN pnpm install --frozen-lockfile --filter @kokoro/admin-web...

FROM dependencies AS builder
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @kokoro/admin-web build

FROM node:24.13.0-alpine3.23@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    HOME=/tmp
RUN addgroup --system --gid 10001 nodejs \
    && adduser --system --uid 10001 --ingroup nodejs nextjs
COPY --from=builder --chown=root:root /workspace/apps/admin/.next/standalone ./
COPY --from=builder --chown=root:root /workspace/apps/admin/.next/static ./apps/admin/.next/static
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --timeout=2 --output-document=/dev/null http://127.0.0.1:3000/api/health/live || exit 1
CMD ["node", "apps/admin/server.js"]
