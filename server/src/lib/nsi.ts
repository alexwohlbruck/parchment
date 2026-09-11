import path from 'node:path'
import { existsSync } from 'node:fs'
import { simplify } from 'name-suggestion-index'
import { logger, logWarn } from './logger'

/**
 * Name Suggestion Index — the canonical brand/operator catalog OSM editors use
 * to tag chains consistently (`brand`, `brand:wikidata`, and whatever else the
 * chain always carries: cuisine, takeaway, payment…).
 *
 * NSI ships a `Matcher` that does all of this, but building its index costs
 * ~320 MB of RSS. The index here keeps the same inputs — simplified names,
 * match groups, per-tag exclusions — at a fraction of the size.
 */

export interface NsiBrand {
  id: string
  name: string
  /** "amenity/fast_food" — the primary tag this brand belongs to. */
  kv: string
  tags: Record<string, string>
  wikidata: string | null
  logoUrl: string | null
  /** ISO country codes the brand operates in, for location-aware ranking. */
  countries: string[]
  /** How many places the brand operates in, as a rough popularity signal. */
  reach: number
}

interface KvEntry {
  brands: NsiBrand[]
  /** Simplified name (NSI's own normalization) → brand. */
  byName: Map<string, NsiBrand>
  /** Names too generic to imply a brand, e.g. "pizzeria" for fast food. */
  exclusions: RegExp[]
}

interface BrandIndex {
  byKv: Map<string, KvEntry>
  byId: Map<string, NsiBrand>
  /** Primary tag → the tags a brand may legitimately also appear under. */
  matchGroups: Map<string, string[]>
}

/** Reach for the worldwide chains NSI marks with the "001" region — above any
 *  real country count, and finite so it survives JSON. */
const WORLDWIDE_REACH = 1000

let index: BrandIndex | null = null
let indexAttempted = false

/**
 * The package's `exports` map omits the leading "./" on its data subpaths, so
 * neither Node nor Bun will resolve them by name. Locate the package root from
 * its entry point instead — which entry resolves depends on the runtime, so
 * walk up to the directory holding its package.json.
 */
function dataPath(...segments: string[]): string {
  let dir = path.dirname(require.resolve('name-suggestion-index'))
  while (!existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('name-suggestion-index package root not found')
    dir = parent
  }
  return path.join(dir, 'dist', ...segments)
}

/** The raw JSON is ~22 MB across two files; drop it once the index is built. */
function loadAndRelease<T>(file: string): T {
  const data = require(file) as T
  delete require.cache[require.resolve(file)]
  return data
}

function compileExclusions(properties: any): RegExp[] {
  const patterns = [
    ...(properties?.exclude?.generic ?? []),
    ...(properties?.exclude?.named ?? []),
  ]
  return patterns.flatMap((pattern: string) => {
    try {
      return [new RegExp(pattern, 'i')]
    } catch {
      return []
    }
  })
}

function buildIndex(): BrandIndex | null {
  try {
    const nsiRaw = loadAndRelease<any>(dataPath('json', 'nsi.min.json'))
    const nsiData = nsiRaw.nsi ?? nsiRaw

    const wikidataRaw = loadAndRelease<any>(
      dataPath('wikidata', 'wikidata.min.json'),
    )
    const wikidataData = wikidataRaw.wikidata ?? wikidataRaw

    const groupsRaw = loadAndRelease<any>(dataPath('json', 'matchGroups.min.json'))
    const groupsData = groupsRaw.matchGroups ?? groupsRaw

    const matchGroups = new Map<string, string[]>()
    for (const members of Object.values<string[]>(groupsData)) {
      for (const member of members) matchGroups.set(member, members)
    }

    const byKv = new Map<string, KvEntry>()
    const byId = new Map<string, NsiBrand>()

    for (const [treePath, entry] of Object.entries<any>(nsiData)) {
      const [tree, key, value] = treePath.split('/')
      // Brands only. The operators tree is larger than brands and doubles the
      // index for utility and transit networks no one adds through quick edit;
      // flags and transit routes are catalogs of something else entirely.
      if (tree !== 'brands') continue

      const kv = `${key}/${value}`
      const kvEntry: KvEntry = byKv.get(kv) ?? {
        brands: [],
        byName: new Map(),
        exclusions: compileExclusions(entry.properties),
      }

      for (const item of entry.items ?? []) {
        const wikidata =
          item.tags?.['brand:wikidata'] ?? null
        const wd = wikidata ? wikidataData[wikidata] : null
        const locations: string[] = (item.locationSet?.include ?? []).filter(
          (l: unknown): l is string => typeof l === 'string',
        )

        const brand: NsiBrand = {
          id: item.id,
          name: item.displayName,
          kv,
          tags: item.tags ?? {},
          wikidata,
          logoUrl: wd?.logos?.facebook ?? wd?.logos?.wikidata ?? null,
          countries: locations.filter((l) => /^[a-z]{2}$/.test(l)),
          reach: locations.includes('001') ? WORLDWIDE_REACH : locations.length,
        }

        kvEntry.brands.push(brand)
        byId.set(brand.id, brand)

        const names = [
          item.displayName,
          item.tags?.name,
          item.tags?.brand,
          item.tags?.operator,
          ...(item.matchNames ?? []),
        ]
        for (const name of names) {
          if (!name) continue
          const simplified = simplify(name)
          if (simplified && !kvEntry.byName.has(simplified)) {
            kvEntry.byName.set(simplified, brand)
          }
        }
      }

      byKv.set(kv, kvEntry)
    }

    logger.debug(`NSI index built: ${byId.size} brands across ${byKv.size} tags`)
    return { byKv, byId, matchGroups }
  } catch (error) {
    logWarn('Could not build the Name Suggestion Index', error)
    return null
  }
}

function getIndex(): BrandIndex | null {
  if (!index && !indexAttempted) {
    indexAttempted = true
    index = buildIndex()
  }
  return index
}

function scoreName(name: string, query: string): number {
  const n = name.toLowerCase()
  if (n === query) return 100
  if (n.startsWith(query)) return 80
  if (n.split(/\s+/).some((w) => w.startsWith(query))) return 60
  if (n.includes(query)) return 40
  return 0
}

/**
 * Brands matching a name, within the feature's primary tag.
 *
 * `country` only reorders: a brand whose location set excludes the country is
 * still offered, since NSI location sets lag reality and the user knows better.
 */
export function searchBrands(
  query: string,
  kv: string,
  country?: string,
  limit = 6,
): NsiBrand[] {
  const idx = getIndex()
  const q = query.trim().toLowerCase()
  if (!idx || q.length < 2) return []

  const scored: Array<{ brand: NsiBrand; score: number }> = []
  for (const brand of idx.byKv.get(kv)?.brands ?? []) {
    const score = scoreName(brand.name, q)
    if (!score) continue
    const local =
      !country || !brand.countries.length || brand.countries.includes(country)
    scored.push({ brand, score: local ? score : score - 20 })
  }

  // NSI carries several entries per chain — localized names and
  // transliterations sharing one QID. Collapse them to a single row, keeping
  // the entry with the widest reach, which is the chain's canonical spelling.
  const byChain = new Map<string, { brand: NsiBrand; score: number }>()
  for (const candidate of scored) {
    const chain = candidate.brand.wikidata ?? candidate.brand.id
    const current = byChain.get(chain)
    if (!current) {
      byChain.set(chain, candidate)
      continue
    }
    if (candidate.brand.reach > current.brand.reach) {
      byChain.set(chain, { brand: candidate.brand, score: Math.max(candidate.score, current.score) })
    } else {
      current.score = Math.max(current.score, candidate.score)
    }
  }

  // Reach breaks score ties: searching "taco" should reach Taco Bell before a
  // two-country chain that merely has a shorter name.
  return [...byChain.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.brand.reach - a.brand.reach ||
        a.brand.name.length - b.brand.name.length,
    )
    .slice(0, limit)
    .map((s) => s.brand)
}

/**
 * The brand a feature's tags look like — an exact name match after NSI's own
 * normalization, so "taco bell", "Taco Bell #1234" and "TacoBell" all resolve.
 *
 * Searches the whole match group, since a chain catalogued under
 * `amenity/fast_food` is often tagged `amenity/restaurant` in the wild. Names
 * the tag's exclusion list calls generic ("pizzeria", "kiosk") never match.
 */
export function matchBrand(kv: string, name: string): NsiBrand | null {
  const idx = getIndex()
  if (!idx || !name.trim()) return null

  const entry = idx.byKv.get(kv)
  if (entry?.exclusions.some((pattern) => pattern.test(name.trim()))) return null

  const simplified = simplify(name)
  if (!simplified) return null

  for (const candidateKv of idx.matchGroups.get(kv) ?? [kv]) {
    const brand = idx.byKv.get(candidateKv)?.byName.get(simplified)
    if (brand) return brand
  }
  return null
}

/** The tags a brand would add or correct on a feature, ignoring equal values. */
export function brandTagDiff(
  brand: NsiBrand,
  tags: Record<string, string>,
): Array<{ key: string; from: string | null; to: string }> {
  return Object.entries(brand.tags)
    .filter(([key, value]) => tags[key] !== value)
    .map(([key, value]) => ({ key, from: tags[key] ?? null, to: value }))
}

export function getBrandById(id: string): NsiBrand | null {
  return getIndex()?.byId.get(id) ?? null
}
