import path from 'path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'
import svgLoader from 'vite-svg-loader'
import { VitePWA } from 'vite-plugin-pwa'
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

/**
 * Name the browser tab after the preview it belongs to.
 *
 * Every branch preview (scripts/preview.sh) serves the same app on its own
 * port, so a row of open tabs is otherwise indistinguishable. The label — the
 * branch's pull request title, or the branch name — is put first, because that
 * is the part still readable once tabs shrink. Unset outside previews, where
 * the title in index.html stands.
 */
function previewTitle(): Plugin {
  const label = process.env.VITE_PREVIEW_LABEL?.trim()
  if (!label) return { name: 'preview-title' }
  const escaped = label.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)
  return {
    name: 'preview-title',
    transformIndexHtml: (html) =>
      html.replace(/<title>.*?<\/title>/, `<title>${escaped} · Parchment</title>`),
  }
}

const IDENTITY_KEYS = ['parchment-identity-seed', 'parchment-device-id']
const IDENTITY_PATH = '/__preview-identity'

/**
 * Carry the base instance's sign-in over to branch previews.
 *
 * Each preview is its own origin, so its localStorage starts without the
 * wrapped identity seed and the recovery key has to be entered again. The base
 * (PREVIEW_IDENTITY_SHARE) serves a page that hands those keys to same-host
 * frames; a fresh preview (PREVIEW_IDENTITY_SOURCE) fetches them once and
 * reloads. The seed only unwraps with a session, which scripts/preview.sh
 * copies into the preview's database.
 */
function previewIdentity(): Plugin {
  const keys = JSON.stringify(IDENTITY_KEYS)
  const source = process.env.PREVIEW_IDENTITY_SOURCE?.trim()
  const share = process.env.PREVIEW_IDENTITY_SHARE === '1'

  const sharePage = `<!doctype html><script>
addEventListener('message', (e) => {
  if (e.data !== 'parchment-preview-identity') return
  if (new URL(e.origin).hostname !== location.hostname) return
  const entries = ${keys}.map((k) => [k, localStorage.getItem(k)])
  e.source.postMessage(Object.fromEntries(entries), e.origin)
})
</script>`

  const fetchScript = `(() => {
  const keys = ${keys}, source = ${JSON.stringify(source)}
  if (localStorage.getItem(keys[0])) return
  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.src = source + '${IDENTITY_PATH}'
  addEventListener('message', function receive(e) {
    if (e.origin !== source) return
    removeEventListener('message', receive)
    frame.remove()
    if (!keys.every((k) => e.data?.[k])) return
    keys.forEach((k) => localStorage.setItem(k, e.data[k]))
    location.reload()
  })
  frame.onload = () => frame.contentWindow.postMessage('parchment-preview-identity', source)
  document.documentElement.append(frame)
})()`

  return {
    name: 'preview-identity',
    apply: 'serve',
    configureServer(server) {
      if (!share) return
      server.middlewares.use(IDENTITY_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(sharePage)
      })
    },
    transformIndexHtml: () =>
      source ? [{ tag: 'script', children: fetchScript, injectTo: 'head-prepend' }] : [],
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
    previewTitle(),
    previewIdentity(),
    // Offline-capable PWA. Custom worker (src/service-worker.ts) precaches only the app
    // shell — the full dist is ~24MB across 1600+ files, mostly lazy chunks
    // that runtime caching picks up as they're used. Registration happens in
    // src/lib/pwa.ts (production web only, not Tauri).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'service-worker.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Parchment',
        short_name: 'Parchment',
        description: 'Maps, places, directions, and transit',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: [
          'index.html',
          'assets/index-*.{js,css}',
          'assets/maplibre-gl-*.mjs',
          'favicon.svg',
          'parchment.svg',
          'icons/*.png',
        ],
        // The single entry chunk is ~8MB; the default 2MB cap would silently
        // drop it from the precache and break offline startup.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
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
