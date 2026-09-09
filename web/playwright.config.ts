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
  
  // CI: 2 workers to speed up (runner has limited CPU; 2 is a safe balance). Local: use default (CPU-based).
  workers: process.env.CI ? 2 : undefined,
  
  // Reporter: in CI use 'list' so test names show in the Actions log; always keep 'html' for the report artifact
  reporter: process.env.CI ? [['list'], ['html']] : 'html',
  
  // Shared settings for all the projects below
  use: {
    // Base URL: use 5174 for e2e so it doesn't conflict with a dev server on 5173
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5174',
    
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
  },

  // Per-test budget. The old 30s default was routinely exceeded on CI's
  // 2-worker runner, which is what produced a suite-wide "fails once, passes
  // on retry" pattern rather than any real instability.
  timeout: 60 * 1000,

  // Configure projects for major browsers
  projects: [
    // Signs in once; every other project replays the saved state.
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { 
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
        // Enable WebGL support in headless mode
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--disable-gpu-sandbox',
          ],
        },
        // NOTE: no `contextOptions.storageState` here — it used to be set to
        // `undefined`, which silently clobbers the storageState above. The
        // map strategy detects automation via `navigator.webdriver`, which
        // Playwright sets on its own.
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
