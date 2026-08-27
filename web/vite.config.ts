import path from 'path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import svgLoader from 'vite-svg-loader'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    vue(),
    svgLoader({
      defaultImport: 'url', // Import as URL by default
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, '../server/src'),
    },
  },
  optimizeDeps: {
    include: ['@morev/vue-transitions'],
    // MapLibre 6 is ESM-only and loads its worker as a real URL rather than a
    // blob — `new Worker(new URL('./maplibre-gl-worker.mjs', import.meta.url))`.
    // Pre-bundling rewrites that module into `.vite/deps/`, where the worker
    // file does not exist, so the request comes back empty and the map never
    // starts: "Loading Worker ... blocked because of a disallowed MIME type".
    // Excluding it serves the package's own ESM straight from node_modules, so
    // the worker URL resolves next to the module that asks for it.
    exclude: ['maplibre-gl'],
  },
  server: {
    port: parseInt(process.env.VITE_PORT || '5173'),
    // host: host || false,
    // strictPort: true,
    // Branch previews (scripts/preview.sh) are reached through `tailscale
    // serve`, which terminates TLS on a tailnet hostname and proxies here.
    // Vite rejects Host headers it wasn't told about, so the preview passes
    // the hostname it publishes under.
    allowedHosts: process.env.VITE_ALLOWED_HOSTS?.split(',').filter(Boolean),
    // Behind that proxy the HMR client would otherwise dial this origin port
    // directly — which isn't reachable from a phone. Point it at the public
    // origin the page was actually loaded from.
    hmr: process.env.VITE_PUBLIC_HOST
      ? {
          protocol: process.env.VITE_PUBLIC_PROTOCOL === 'https' ? 'wss' : 'ws',
          host: process.env.VITE_PUBLIC_HOST,
          clientPort: parseInt(process.env.VITE_PUBLIC_PORT || '443'),
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/target/**'],
    },
  },
  // envPrefix: ['VITE_', 'TAURI_ENV_*'],
  // build: {
  //   target:
  //     process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
  //   minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
  //   sourcemap: !!process.env.TAURI_ENV_DEBUG,
  // },
})
