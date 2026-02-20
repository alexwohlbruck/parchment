import { defineConfig, devices } from '@playwright/test'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { fileURLToPath } from 'url'

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// E2E env: prefer web/e2e/env.test (gitignored), else repo root .env.test
const e2eEnv = path.resolve(__dirname, 'e2e/env.test')
const rootEnv = path.resolve(__dirname, '../.env.test')
const fs = await import('fs')
if (fs.existsSync(e2eEnv)) {
  dotenv.config({ path: e2eEnv })
} else {
  dotenv.config({ path: rootEnv })
}

/**
 * Playwright configuration for e2e tests.
 * Requires Docker: starts test server and DB via globalSetup, tears down in globalTeardown.
 *
 * Run from the web/ directory so tests are discovered (e.g. cd web && bun run test:e2e:ui).
 * From repo root: use VS Code task "E2E: Open Playwright UI" or run: cd web && bun run test:e2e:ui
 */
export default defineConfig({
  testDir: './e2e',
  
  globalSetup: path.resolve(__dirname, 'e2e/global-setup.ts'),
  globalTeardown: path.resolve(__dirname, 'e2e/global-teardown.ts'),
  
  // Run tests in files in parallel
  fullyParallel: true,
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,
  
  // Reporter to use
  reporter: 'html',
  
  // Shared settings for all the projects below
  use: {
    // Base URL: use 5174 for e2e so it doesn't conflict with a dev server on 5173
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5174',
    
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        // Enable WebGL support in headless mode
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--disable-gpu-sandbox',
          ],
        },
        // Inject flag to indicate we're in a test environment
        contextOptions: {
          // This will be available as window.__playwright
          storageState: undefined,
        },
      },
    },
  ],

  // Run local dev server on 5174 (avoids conflict with dev on 5173); point at Docker test backend
  webServer: process.env.PLAYWRIGHT_SKIP_SERVER ? undefined : {
    command: 'bun run dev -- --port 5174',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 120 * 1000,
    env: { ...process.env, VITE_SERVER_ORIGIN: process.env.SERVER_ORIGIN || 'http://localhost:5001' },
  },
})
