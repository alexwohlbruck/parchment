/**
 * Test runner — executes each test file in its own `bun test` process.
 *
 * Why not plain `bun test src/`? Bun runs every file in one process and shares
 * the module registry across them, so `mock.module('axios', ...)` in one file
 * stays installed for every file that runs after it. Worse, a module already
 * evaluated with the real dependency keeps it: an integration that builds
 * pooled `axios.create()` clients at import time captures real axios if any
 * earlier file imported it first. The result is tests that pass alone and fail
 * in a suite — 92 such failures across this suite before this runner existed.
 *
 * Jest and Vitest isolate per file by default; this restores that. The cost is
 * one process spawn per file (~50ms), run at CPU-count concurrency.
 *
 * Usage:
 *   bun scripts/run-tests.ts             # unit files (*.test.ts, excluding *.db.test.ts)
 *   bun scripts/run-tests.ts --db        # DB-backed files (*.db.test.ts)
 *   bun scripts/run-tests.ts -- -t "foo" # trailing args pass through to `bun test`
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { cpus } from 'node:os'

const args = process.argv.slice(2)
const separator = args.indexOf('--')
const flags = separator === -1 ? args : args.slice(0, separator)
const passThrough = separator === -1 ? [] : args.slice(separator + 1)
const dbMode = flags.includes('--db')

/** Recursively collect test files under src/ matching the selected mode. */
async function findTestFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await findTestFiles(path)))
    } else if (entry.name.endsWith('.test.ts')) {
      const isDbTest = entry.name.endsWith('.db.test.ts')
      if (isDbTest === dbMode) files.push(path)
    }
  }
  return files
}

interface Result {
  file: string
  ok: boolean
  pass: number
  fail: number
  output: string
}

async function runFile(file: string): Promise<Result> {
  const proc = Bun.spawn(['bun', 'test', file, ...passThrough], {
    stdout: 'pipe',
    stderr: 'pipe',
    // `bun test` normally defaults NODE_ENV to "test", but handing it an
    // explicit env object suppresses that default and the parent's value
    // (often "development") leaks in. Set it so a file behaves identically
    // whether run through this runner or invoked directly.
    env: { ...process.env, NODE_ENV: 'test' },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const output = stdout + stderr
  // Bun prints a trailing " N pass" / " N fail" summary per run.
  const pass = Number(output.match(/^\s*(\d+) pass$/m)?.[1] ?? 0)
  const fail = Number(output.match(/^\s*(\d+) fail$/m)?.[1] ?? 0)
  return { file, ok: exitCode === 0, pass, fail, output }
}

/** Run `tasks` with at most `limit` in flight, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

const files = (await findTestFiles('src')).sort()
if (files.length === 0) {
  console.error(`No ${dbMode ? 'DB-backed' : 'unit'} test files found under src/`)
  process.exit(1)
}

const label = dbMode ? 'DB-backed' : 'unit'
console.log(`Running ${files.length} ${label} test files (isolated processes)\n`)

// DB tests share one Postgres and seed real rows, so run them serially to keep
// failures readable and avoid contention on the single test database.
const concurrency = dbMode ? 1 : Math.max(2, cpus().length - 2)
const results = await mapWithConcurrency(files, concurrency, runFile)

for (const result of results) {
  const status = result.ok ? 'pass' : 'FAIL'
  console.log(`  ${status}  ${result.file}  (${result.pass} passed, ${result.fail} failed)`)
}

const failed = results.filter((result) => !result.ok)
if (failed.length > 0) {
  for (const result of failed) {
    console.log(`\n${'─'.repeat(72)}\n${result.file}\n${'─'.repeat(72)}`)
    console.log(result.output)
  }
}

const totalPass = results.reduce((sum, result) => sum + result.pass, 0)
const totalFail = results.reduce((sum, result) => sum + result.fail, 0)
console.log(
  `\n${totalPass} passed, ${totalFail} failed across ${files.length} files` +
    (failed.length > 0 ? ` — ${failed.length} file(s) failed` : ''),
)

process.exit(failed.length > 0 ? 1 : 0)
