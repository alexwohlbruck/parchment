import { createMDX } from 'fumadocs-mdx/next'

import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Prevent Next.js from walking up to the monorepo root for file tracing
  outputFileTracingRoot: resolve(__dirname, '..'),
}

const withMDX = createMDX()

export default withMDX(config)
