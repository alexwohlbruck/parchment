import path from 'path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [vue()],
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
  },
  // envPrefix: ['VITE_', 'TAURI_ENV_*'],
  // build: {
  //   target:
  //     process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
  //   minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
  //   sourcemap: !!process.env.TAURI_ENV_DEBUG,
  // },
})
