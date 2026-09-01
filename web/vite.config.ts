import path from 'path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'
import svgLoader from 'vite-svg-loader'
import { readFileSync } from 'fs'
import { createRequire } from 'module'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

const host = process.env.TAURI_DEV_HOST

/**
 * Ship the chunk MapLibre's worker imports.
 *
 * `maplibre.strategy.ts` pulls the worker in with `?url`, which copies the file
 * verbatim and hands back its URL. Verbatim means its own
 * `import ... from './maplibre-gl-shared.mjs'` is left exactly as written, and
 * Rollup never sees it, so that sibling is never emitted. The dev server gets
 * away with it because `optimizeDeps.exclude` serves MapLibre straight from
 * `node_modules`, where the two files already sit side by side — a production
 * build has only the worker.
 *
 * The failure is silent and total: the import 404s (or, behind an SPA fallback,
 * comes back as `index.html`), the worker dies before it can report anything,
 * and every source stays pending forever. No tiles are ever requested, no error
 * is raised, and the map renders blank.
 *
 * The worker's import is relative and unhashed, so the sibling has to keep that
 * exact name — hence `fileName` rather than the usual hashed asset naming.
 */
function maplibreWorkerChunk(): Plugin {
  return {
    name: 'maplibre-worker-shared-chunk',
    apply: 'build',
    generateBundle() {
      const require = createRequire(import.meta.url)
      const shared = require.resolve(
        'maplibre-gl/dist/maplibre-gl-shared.mjs',
      )
      this.emitFile({
        type: 'asset',
        fileName: 'assets/maplibre-gl-shared.mjs',
        source: readFileSync(shared, 'utf-8'),
      })
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    vue(),
    svgLoader({
      defaultImport: 'url', // Import as URL by default
    }),
    maplibreWorkerChunk(),
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
