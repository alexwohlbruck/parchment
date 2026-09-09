/**
 * Global teardown for Playwright e2e tests.
 * Stops Docker test stack and removes volumes.
 */
import { FullConfig } from '@playwright/test'
import { spawn } from 'child_process'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: opts.cwd || repoRoot,
      env: process.env,
    })
    proc.on('error', reject)
    proc.on('close', code => resolve(code ?? 0))
  })
}

async function globalTeardown(config: FullConfig) {
  const envFile = path.join(repoRoot, '.env.test')
  console.log('Stopping Docker test environment...')
  await run('docker', ['compose', '-f', 'docker-compose.test.yml', '--env-file', envFile, 'down', '-v'])
  console.log('Docker test environment stopped.')
}

export default globalTeardown
