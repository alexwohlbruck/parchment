#!/usr/bin/env node
/**
 * Prints the CHANGELOG.md section for a given version (e.g. 0.0.15).
 * Used by the release workflow to set the GitHub Release body.
 * Usage: node extract-changelog-section.mjs <version>
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const version = process.argv[2]
if (!version) {
  console.error('Usage: node extract-changelog-section.mjs <version>')
  process.exit(1)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')
const lines = changelog.split('\n')

const startPattern = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`)
let inSection = false
const out = []

for (const line of lines) {
  if (startPattern.test(line)) {
    inSection = true
    out.push(line)
    continue
  }
  if (inSection) {
    if (/^## \[/.test(line)) break // next version section
    out.push(line)
  }
}

console.log(out.join('\n').trim() || `## ${version}\n\nSee CHANGELOG.md for details.`)
