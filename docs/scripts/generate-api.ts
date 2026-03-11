// Load the monorepo root .env for SERVER_ORIGIN before anything else.
// Bun only auto-loads .env from the package root (/docs), not from parent dirs.
import { resolve } from 'path'

const rootEnvPath = resolve(import.meta.dirname, '../../.env')
const rootEnvFile = Bun.file(rootEnvPath)

if (await rootEnvFile.exists()) {
  const text = await rootEnvFile.text()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}

import { generateFiles } from 'fumadocs-openapi'

const serverOrigin = process.env.SERVER_ORIGIN ?? 'http://localhost:5000'
const specUrl = `${serverOrigin}/docs/json`

console.log(`Fetching OpenAPI spec from: ${specUrl}`)

await generateFiles({
  input: [specUrl],
  output: './content/docs/api',
  per: 'tag',
  includeDescription: true,
})

console.log('API reference pages generated in content/docs/api/')
