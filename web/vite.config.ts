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
  },
  server: {
    port: parseInt(process.env.VITE_PORT || '5173'),
    // host: host || false,
    // strictPort: true,
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
