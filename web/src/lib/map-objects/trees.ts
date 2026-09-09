/**
 * Trees, the first and by far the most numerous of the 3D object layers.
 *
 * Two things decide how a tree is drawn: what OSM says, and — for the great
 * majority that say almost nothing — what its id hashes to.
 *
 * WHAT OSM SAYS. There are official tags for all of this and they are read
 * first, in the order a surveyor would trust them:
 *
 *   height          the real thing, and rare — under 1% of the 300k trees in
 *                   the current extract carry one
 *   est_height      a surveyor's estimate, which is still better than a guess
 *   diameter_crown  the canopy across, in metres — sets the spread directly
 *   circumference   the trunk's girth. Not a height, but strongly correlated
 *                   with one, so a girth with no height still narrows it down
 *   leaf_type       broadleaved or needleleaved, the one tag with real coverage
 *                   (~13%), and the one that picks the model
 *   genus / species which of the three families this is, including the palms
 *                   that `leaf_type` has no value for
 *   denotation      a street tree is pruned and smaller than one with room
 *
 * WHAT THE ID DECIDES. Everything still missing, through `vary.ts`: which of
 * the several models of its family, how tall within a plausible range for that
 * family, how wide relative to its height, which way it faces, and a few
 * percent either way on its greens. Deterministic, so the same tree is the same
 * tree on every reload, and uncorrelated between properties, so a row of them
 * does not come out as a repeating pattern.
 */
import { TREE_SOURCE, TREE_TILES, TREE_ROW_SOURCE, TREE_ROW_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { hash, lerp, pick, tagged } from './vary'

/**
 * The models, keyed by family. Several each on purpose: which one a tree gets
 * comes from its id, and it is the single biggest thing separating a street of
 * trees from a diagram of one tree repeated.
 */
export const TREE_FAMILIES = {
  broadleaf: ['tree-broadleaf-a', 'tree-broadleaf-b', 'tree-broadleaf-c', 'tree-broadleaf-d'],
  conifer: ['tree-conifer-a', 'tree-conifer-b', 'tree-conifer-c', 'tree-conifer-d'],
  palm: ['tree-palm-a', 'tree-palm-b', 'tree-palm-c'],
} as const

export type TreeFamily = keyof typeof TREE_FAMILIES

export const TREE_MODELS = Object.fromEntries(
  Object.values(TREE_FAMILIES).flat().map(name => [name, `/models/${name}.glb`]),
)

/** Genera that are palms, and genera that are conifers, where OSM names one. */
const PALM_GENERA = /^(phoenix|washingtonia|roystonea|cocos|sabal|trachycarpus|butia|syagrus|livistona|chamaerops)/i
const CONIFER_GENERA = /^(pinus|picea|abies|cedrus|juniperus|thuja|taxus|tsuga|larix|cupressus|chamaecyparis|sequoia|cryptomeria|metasequoia)/i

/** Plausible heights, per family — a palm is tall and thin, a pine taller. */
const HEIGHT: Record<TreeFamily, { min: number; max: number }> = {
  broadleaf: { min: 7, max: 15 },
  conifer: { min: 9, max: 20 },
  palm: { min: 8, max: 16 },
}

/** A street tree is pruned to clear the traffic and the wires above it. */
const STREET_HEIGHT = { min: 5, max: 9.5 }

/** Canopy across, as a fraction of height. A palm's crown is a tuft. */
const SPREAD: Record<TreeFamily, { min: number; max: number }> = {
  broadleaf: { min: 0.55, max: 0.9 },
  conifer: { min: 0.32, max: 0.5 },
  palm: { min: 0.3, max: 0.45 },
}

/**
 * Trunk girth to height. A rough allometric rule — girth in metres times this
 * lands within a couple of metres for the street and park trees this draws,
 * which is far closer than the family's midpoint would be.
 */
const GIRTH_TO_HEIGHT = 11

export function treeFamily(props: Record<string, any>): TreeFamily {
  const taxon = `${props.genus ?? ''} ${props.species ?? ''} ${props.taxon ?? ''}`.trim()
  if (PALM_GENERA.test(taxon)) return 'palm'
  if (CONIFER_GENERA.test(taxon)) return 'conifer'
  if (props.leaf_type === 'needleleaved') return 'conifer'
  return 'broadleaf'
}

/**
 * Shape one tree.
 *
 * `seedSuffix` lets a tree row give each of its trees a different draw from the
 * same feature id — without it every tree along an avenue would be identical.
 */
export function treeInstance(
  feature: any,
  lng: number,
  lat: number,
  seedSuffix: number | string = '',
): ObjectInstance | null {
  const props = feature.properties ?? {}
  const seed = `${props.id ?? feature.id ?? `${lng},${lat}`}${seedSuffix === '' ? '' : `#${seedSuffix}`}`
  const family = treeFamily(props)

  // Measured, estimated, inferred from girth, then guessed — in that order.
  const street = props.denotation === 'street' || props.denotation === 'avenue'
  const girth = tagged(props.circumference, 0.1, 12)
  const height =
    tagged(props.height, 1, 90) ??
    tagged(props.est_height, 1, 90) ??
    (girth === null ? null : Math.min(30, girth * GIRTH_TO_HEIGHT)) ??
    lerp(street ? STREET_HEIGHT : HEIGHT[family], hash(seed, 1))

  // A measured crown wins over any ratio; otherwise it follows the height.
  const crown = tagged(props.diameter_crown, 0.5, 40)
  const spread = crown ?? height * lerp(SPREAD[family], hash(seed, 2))

  return {
    lng,
    lat,
    height,
    spread,
    heading: hash(seed, 3) * Math.PI * 2,
    // ±12% on the model's own greens, so a stand of trees is not one flat
    // block of colour.
    shade: 0.88 + hash(seed, 4) * 0.24,
    model: pick(TREE_FAMILIES[family], hash(seed, 5)),
  }
}

export const TREE_OBJECTS: ObjectSourceSpec = {
  source: TREE_SOURCE,
  sourceLayer: TREE_TILES,
  // Matches the flat form's minzoom: the two are the same features, and a zoom
  // where one draws and the other does not would show as trees appearing twice.
  minzoom: 16,
  toInstance: treeInstance,
}

// ---------------------------------------------------------------------------
// Tree rows
// ---------------------------------------------------------------------------

/**
 * How far apart trees stand along a row, in metres.
 *
 * The spacing is not in the data — `natural=tree_row` is a bare line — so it is
 * chosen to look like a planted avenue rather than a hedge. Real street
 * plantings run 6–12m apart depending on species; the middle of that reads
 * right at map scale and keeps the instance count sane on a long boulevard.
 */
const ROW_SPACING = 9

/** Beyond this a single row would dominate the whole instance budget. */
const MAX_PER_ROW = 400

const EARTH_METRES_PER_DEGREE = 111320

/**
 * Walk a row's line and drop a tree every `ROW_SPACING` metres.
 *
 * Positions come out in the line's own order, so the same row produces the same
 * trees in the same places whatever tile it arrived on — which matters, because
 * a row crossing a tile boundary is delivered clipped and twice.
 */
export function walkLine(
  coordinates: Array<[number, number]>,
  spacingMetres = ROW_SPACING,
  limit = MAX_PER_ROW,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  if (!coordinates?.length) return out

  // Degrees of longitude shrink towards the poles; at the latitudes this draws
  // at, one cosine for the whole line is close enough.
  const cos = Math.cos((coordinates[0][1] * Math.PI) / 180) || 1
  const metres = (a: [number, number], b: [number, number]) =>
    Math.hypot((b[0] - a[0]) * cos, b[1] - a[1]) * EARTH_METRES_PER_DEGREE

  let carry = 0
  out.push(coordinates[0])
  for (let i = 1; i < coordinates.length && out.length < limit; i++) {
    const from = coordinates[i - 1]
    const to = coordinates[i]
    const length = metres(from, to)
    if (length <= 0) continue
    let at = spacingMetres - carry
    while (at < length && out.length < limit) {
      const t = at / length
      out.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t])
      at += spacingMetres
    }
    carry = (carry + length) % spacingMetres
  }
  return out
}

function rowPositions(feature: any): Array<[number, number]> {
  const geometry = feature.geometry
  if (!geometry) return []
  const lines: Array<Array<[number, number]>> =
    geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates]
  return lines.flatMap(line => walkLine(line))
}

export const TREE_ROW_OBJECTS: ObjectSourceSpec = {
  source: TREE_ROW_SOURCE,
  sourceLayer: TREE_ROW_TILES,
  minzoom: 16,
  positions: rowPositions,
  // A row is one feature, so each tree along it is seeded by its index or they
  // would all come out identical.
  toInstance: (feature, lng, lat, index) => treeInstance(feature, lng, lat, index),
}
