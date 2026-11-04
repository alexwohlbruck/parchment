/**
 * Re-runs a plain `bun test` as `bun test --parallel`, which gives each file a
 * fresh module registry. Without it, `mock.module` stubs from one file stay
 * installed for every file after it and hundreds of tests fail spuriously.
 */

import { readFileSync } from 'node:fs'

const ISOLATING_FLAGS = ['--isolate', '--parallel', '--test-worker']

function commandLine(): string[] {
  try {
    return readFileSync('/proc/self/cmdline', 'utf8').split('\0').filter(Boolean)
  } catch {
    const ps = Bun.spawnSync(['ps', '-ww', '-o', 'args=', '-p', String(process.pid)])
    return ps.stdout.toString().trim().split(/\s+/)
  }
}

const args = commandLine()
const testIndex = args.indexOf('test')
const isolated = args.some((arg) =>
  ISOLATING_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)),
)

if (testIndex !== -1 && !isolated) {
  const rest = args.slice(testIndex + 1)
  const mode = rest.includes('--watch') ? '--isolate' : '--parallel'
  const { exitCode } = Bun.spawnSync([process.execPath, 'test', mode, ...rest], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exit(exitCode ?? 1)
}
