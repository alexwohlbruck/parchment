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

/** A brand plus the normalized names it can be found by. */
interface BrandEntry {
  brand: NsiBrand
  /** `simplify(displayName)` — punctuation, case and spacing removed. */
  simple: string
  /** Simplified alternates: the chain's own name tags and NSI's matchNames. */
  aliases: string[]
}

interface KvEntry {
  entries: BrandEntry[]
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
        entries: [],
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

        byId.set(brand.id, brand)

        const simple = simplify(brand.name)
        const aliases = new Set<string>()
        for (const name of [
          item.tags?.name,
          item.tags?.brand,
          item.tags?.operator,
          ...(item.matchNames ?? []),
        ]) {
          if (!name) continue
          const simplified = simplify(name)
          if (simplified && simplified !== simple) aliases.add(simplified)
        }

        kvEntry.entries.push({ brand, simple, aliases: [...aliases] })

        for (const simplified of [simple, ...aliases]) {
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
 * How well a brand answers a query, matching the way people actually type
 * chain names: "mcdonalds" has to reach "McDonald's", so the comparison also
 * runs over NSI's normalized forms, which drop punctuation and spacing.
 */
function scoreEntry(entry: BrandEntry, query: string, simpleQuery: string): number {
  let score = scoreName(entry.brand.name, query)
  if (simpleQuery) {
    score = Math.max(score, scoreName(entry.simple, simpleQuery))
    for (const alias of entry.aliases) {
      // An alias is a weaker signal than the chain's display name.
      score = Math.max(score, scoreName(alias, simpleQuery) - 10)
    }
  }
  return score
}

export interface SearchBrandsOptions {
  /** Restrict to a primary tag and its match group; omit to search every chain. */
  kv?: string
  country?: string
  limit?: number
  /** Drop weak matches. Raise it when searching everything, where loose
   *  substring hits on a common word would bury the real answers. */
  minScore?: number
}

/**
 * Brands matching a name, optionally within the feature's primary tag.
 *
 * `country` only reorders: a brand whose location set excludes the country is
 * still offered, since NSI location sets lag reality and the user knows better.
 */
export function searchBrands(
  query: string,
  options: SearchBrandsOptions = {},
): NsiBrand[] {
  const { kv, country, limit = 6, minScore = 1 } = options
  const idx = getIndex()
  const q = query.trim().toLowerCase()
  if (!idx || q.length < 2) return []
  const simpleQuery = simplify(query)

  // Within a tag, search the whole match group, so picking "Restaurant" for a
  // McDonald's still surfaces it — NSI catalogues it under fast food. The
  // chosen tag still wins ties.
  const searchKvs = kv ? (idx.matchGroups.get(kv) ?? [kv]) : [...idx.byKv.keys()]

  const scored: Array<{ brand: NsiBrand; score: number }> = []
  for (const candidateKv of searchKvs) {
    const sameTag = !kv || candidateKv === kv
    for (const entry of idx.byKv.get(candidateKv)?.entries ?? []) {
      const score = scoreEntry(entry, q, simpleQuery)
      if (score < minScore) continue
      const { brand } = entry
      const local =
        !country || !brand.countries.length || brand.countries.includes(country)
      scored.push({
        brand,
        score: score - (local ? 0 : 20) - (sameTag ? 0 : 5),
      })
    }
  }

  // NSI carries several entries per chain — localized names, transliterations
  // and sub-brands sharing one QID. Collapse them to a single row, represented
  // by whichever entry answers the query best: searching "mcdonalds" should
  // land on McDonald's, not its PlayPlace sub-brand. Reach breaks ties, which
  // is what picks the canonical spelling over a transliteration.
  const byChain = new Map<string, { brand: NsiBrand; score: number }>()
  for (const candidate of scored) {
    const chain = candidate.brand.wikidata ?? candidate.brand.id
    const current = byChain.get(chain)
    if (!current) {
      byChain.set(chain, candidate)
      continue
    }
    const better =
      candidate.score > current.score ||
      (candidate.score === current.score &&
        candidate.brand.reach > current.brand.reach)
    if (better) byChain.set(chain, candidate)
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
