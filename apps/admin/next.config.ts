import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  typescript: {
    tsconfigPath: 'tsconfig.next.json',
  },
  turbopack: {
    root: path.resolve(import.meta.dirname, '../..'),
  },
}

export default nextConfig
