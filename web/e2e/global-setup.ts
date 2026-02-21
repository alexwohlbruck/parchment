/**
 * Global setup for Playwright e2e tests.
 * Starts the Docker test stack, waits for server health, then (if env has
 * E2E_* vars set) configures integrations so map tests can run.
 */
import { FullConfig } from '@playwright/test'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { setupE2EIntegrations } from './helpers/e2e-integrations'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

function getEnvFilePath(): string {
  const e2eEnv = path.join(repoRoot, 'web', 'e2e', 'env.test')
  const rootEnv = path.join(repoRoot, '.env.test')
  if (fs.existsSync(e2eEnv)) return e2eEnv
  if (fs.existsSync(rootEnv)) return rootEnv
  throw new Error(
    `No env file found. Copy web/e2e/env.test.example to web/e2e/env.test or repo root .env.test`
  )
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const capture = opts.capture ?? false
    const proc = spawn(cmd, args, {
      stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      cwd: opts.cwd || repoRoot,
      env: { ...process.env, ...opts.env },
    })
    let stdout = ''
    let stderr = ''
    if (capture) {
      proc.stdout?.on('data', (d: Buffer) => {
        const s = d.toString()
        stdout += s
        process.stdout.write(s)
      })
      proc.stderr?.on('data', (d: Buffer) => {
        const s = d.toString()
        stderr += s
        process.stderr.write(s)
      })
    }
    proc.on('error', reject)
    proc.on('close', code => resolve({ code: code ?? 0, stdout, stderr }))
  })
}

async function waitForServer(url: string, maxAttempts = 60): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url)
      // 200 or 207 (degraded) means server is up
      if (res.ok || res.status === 207) return true
    } catch {
      // ignore
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  return false
}

async function globalSetup(config: FullConfig) {
  const envFile = getEnvFilePath()
  console.log('Using env file:', envFile)

  const args = ['compose', '-f', 'docker-compose.test.yml', '--env-file', envFile, 'up', '-d', '--build']
  const composeEnv = {
    ...process.env,
    CLIENT_ORIGIN: 'http://localhost:5174',
  }

  console.log('Starting Docker test environment...')
  console.log('Command: docker', args.join(' '))
  const { code, stdout, stderr } = await run('docker', args, { env: composeEnv, capture: true })
  if (code !== 0) {
    const out = [stdout, stderr].filter(Boolean).join('\n')
    if (out.trim()) console.error('\n--- docker output ---\n' + out.trim() + '\n---')
    throw new Error(
      `Docker compose up failed with code ${code}. See output above. If OrbStack is running, try: docker compose -f docker-compose.test.yml --env-file .env.test up -d --build (from repo root). If the build fails with "lockfile had changes, but lockfile is frozen", ensure server/Dockerfile.prod uses the same Bun major.minor as your local Bun (bun --version).`
    )
  }

  const serverUrl = process.env.SERVER_ORIGIN || 'http://localhost:5001'
  const healthUrl = `${serverUrl.replace(/\/$/, '')}/`
  console.log('Waiting for test server at', healthUrl)
  const ok = await waitForServer(healthUrl)
  if (!ok) {
    const downResult = await run('docker', ['compose', '-f', 'docker-compose.test.yml', '--env-file', envFile, 'down', '-v'], { capture: true })
    if (downResult.code !== 0 && (downResult.stdout || downResult.stderr)) {
      console.error(downResult.stdout || downResult.stderr)
    }
    throw new Error('Test server did not become healthy in time. Check that DB migrated and seeded (see server logs).')
  }
  console.log('Test server is ready.')

  try {
    await setupE2EIntegrations()
  } catch (err) {
    console.warn('E2E integration setup failed (map/integration tests may be skipped):', (err as Error).message)
  }
}

export default globalSetup
