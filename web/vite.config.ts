import path from 'path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import svgLoader from 'vite-svg-loader'
import { existsSync, readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

const host = process.env.TAURI_DEV_HOST

// Local fork of MapLibre GL JS (v4.7.1 + variable `line-offset` via `line-progress`,
// re-impl of mapbox-gl PR #13614). Alias the app to its built UMD dist so transit
// ribbons can offset per-vertex. Same UMD shape as the published build, so named
// imports are unchanged. Only used when the fork checkout actually exists on this
// machine (CI/Docker fall back to the npm package automatically); MAPLIBRE_FORK=0
// opts out even when it exists. MAPLIBRE_FORK_DIR overrides the checkout path.
const MAPLIBRE_FORK_DIR =
  process.env.MAPLIBRE_FORK_DIR ||
  '/Users/alexwohlbruck/Documents/code/maplibre-gl-js'
const useMaplibreFork =
  process.env.MAPLIBRE_FORK !== '0' &&
  existsSync(`${MAPLIBRE_FORK_DIR}/dist/maplibre-gl.js`)
const maplibreAlias = useMaplibreFork
  ? {
      // CSS subpath MUST precede the bare specifier: Vite prefix-matches string
      // aliases, so a bare `maplibre-gl` alias would otherwise mangle this import.
      'maplibre-gl/dist/maplibre-gl.css': `${MAPLIBRE_FORK_DIR}/dist/maplibre-gl.css`,
      'maplibre-gl': `${MAPLIBRE_FORK_DIR}/dist/maplibre-gl.js`,
    }
  : {}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Engine capability flag: true iff `maplibre-gl` is aliased to the local
    // fork (variable line-offset via line-progress). Stock MapLibre builds get
    // false and must degrade progress-driven line-offset expressions — see
    // degradeProgressLineOffset in src/lib/map.utils.ts.
    __MAPLIBRE_FORK__: JSON.stringify(useMaplibreFork),
  },
  plugins: [
    vue(),
    svgLoader({
      defaultImport: 'url', // Import as URL by default
    }),
  ],
  resolve: {
    alias: {
      ...maplibreAlias,
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, '../server/src'),
    },
  },
  optimizeDeps: {
    // Pre-bundle the aliased fork too: its dist is UMD/CJS, so esbuild must convert
    // it to ESM for named imports (`import { Map } from 'maplibre-gl'`) to resolve —
    // same as Vite auto-optimizing the npm package. Excluding it breaks named imports.
    include: ['@morev/vue-transitions', ...(useMaplibreFork ? ['maplibre-gl'] : [])],
  },
  build: {
    // The fork dist lives outside node_modules, so rollup's CommonJS handling
    // (which powers named imports from the UMD build) must be widened to it.
    commonjsOptions: {
      include: [/node_modules/, ...(useMaplibreFork ? [`${MAPLIBRE_FORK_DIR}/**`] : [])],
    },
  },
  server: {
    port: parseInt(process.env.VITE_PORT || '5173'),
    // host: host || false,
    // strictPort: true,
    watch: {
      ignored: ['**/src-tauri/target/**'],
    },
    // Allow Vite to serve the out-of-root MapLibre fork dist.
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        ...(useMaplibreFork ? [MAPLIBRE_FORK_DIR] : []),
      ],
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
