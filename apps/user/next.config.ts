import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type { NextConfig } from "next"

const appRoot = dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: { root: resolve(appRoot, "../..") },
  // 生产镜像：standalone 产物自带精简 node_modules + server.js，容器只需 node server.js。
  output: "standalone",
}

export default nextConfig
