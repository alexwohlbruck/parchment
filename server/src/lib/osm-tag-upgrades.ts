import { matchTags, type GeometryType } from './osm-presets'
import { getPrimaryTag } from './osm-presets'
import { simplify } from 'name-suggestion-index'
import { matchBrand, type NsiBrand } from './nsi'

/**
 * iD's "outdated tags" check: deprecated tags replaced, a preset's implied
 * tags filled in, and a chain's standard tags applied when its name matches.
 */

export interface TagChange {
  key: string
  from: string | null
  to: string | null
}

export interface TagUpgrade {
  changes: TagChange[]
  /** The chain the upgrade comes from, so it can be declined by identity. */
  brand: NsiBrand | null
}

interface DeprecationRule {
  old: Record<string, string>
  replace?: Record<string, string>
}

let deprecations: DeprecationRule[] | null = null

function getDeprecations(): DeprecationRule[] {
  deprecations ??= require('@openstreetmap/id-tagging-schema/dist/deprecated.min.json')
  return deprecations!
}

function replaceDeprecated(tags: Record<string, string>) {
  for (const rule of getDeprecations()) {
    const oldEntries = Object.entries(rule.old)
    const matches = oldEntries.every(
      ([key, value]) => key in tags && (value === '*' || tags[key] === value),
    )
    if (!matches) continue

    const wildcard = oldEntries.find(([, value]) => value === '*')
    const captured = wildcard ? tags[wildcard[0]] : ''
    for (const [key] of oldEntries) delete tags[key]
    for (const [key, value] of Object.entries(rule.replace ?? {})) {
      tags[key] = value === '$1' ? captured : value
    }
  }
}

function addImpliedTags(tags: Record<string, string>, geometry: GeometryType) {
  const addTags = matchTags(tags, geometry)?.preset.addTags ?? {}
  for (const [key, value] of Object.entries(addTags)) {
    if (value !== '*' && !(key in tags)) tags[key] = value
  }
}

function declined(tags: Record<string, string>, brand: NsiBrand): boolean {
  if (tags.nobrand === 'yes') return true
  return (tags['not:brand:wikidata'] ?? '')
    .split(';')
    .includes(brand.wikidata ?? '')
}

function applyBrand(tags: Record<string, string>): NsiBrand | null {
  const primary = getPrimaryTag(tags)
  const name = tags.name || tags.brand || tags.operator
  if (!primary || !name) return null

  const brand = matchBrand(`${primary.key}/${primary.value}`, name)
  if (!brand || declined(tags, brand)) return null
  const existing = tags['brand:wikidata']
  if (existing && existing !== brand.wikidata) return null

  for (const [key, value] of Object.entries(brand.tags)) {
    // Fix the spelling of the chain's name, but keep a branch's own name.
    if (key === 'name' && tags.name && simplify(tags.name) !== simplify(value)) continue
    tags[key] = value
  }
  return brand
}

export function diffTags(
  before: Record<string, string>,
  after: Record<string, string>,
): TagChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys]
    .filter((key) => before[key] !== after[key])
    .map((key) => ({ key, from: before[key] ?? null, to: after[key] ?? null }))
}

export function suggestTagUpgrades(
  tags: Record<string, string>,
  geometry: GeometryType = 'point',
): TagUpgrade {
  const upgraded = { ...tags }
  replaceDeprecated(upgraded)
  addImpliedTags(upgraded, geometry)
  const brand = applyBrand(upgraded)
  const changes = diffTags(tags, upgraded)
  return { changes, brand: changes.length ? brand : null }
}
