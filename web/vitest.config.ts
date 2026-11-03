import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      globals: true,
      include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      // Node 25+ ships a global localStorage that shadows happy-dom's and is
      // undefined without --localstorage-file.
      execArgv: ['--no-experimental-webstorage'],
    },
  })
)


